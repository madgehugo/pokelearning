-- Pokélearning game adapter for mGBA 0.10+.
--
-- Load via mGBA: Tools → Scripting… → File → Load script… → this file.
-- Watches the game's text buffers and sends every new dialogue line to the
-- companion server as newline-delimited JSON over TCP (see docs/adapter-protocol.md).

local CONFIG = {
  host = "127.0.0.1",
  port = 8765,
  checkEveryFrames = 2,  -- how often to read the text buffers
  stableFrames = 6,      -- buffer must be unchanged this many checks before we emit
  cursorStableChecks = 15, -- ROM text (item descriptions…) must stay selected this long (~0.5 s)
  cursorVerifyChecks = 30, -- drop a discovered cursor that doesn't follow a new message
  echo = true,           -- also print each line in the mGBA scripting console
}

local ADAPTER = "mgba-gen3"
local VERSION = "0.1.0"

---------------------------------------------------------------------------
-- module loading (works from any folder, and survives reloading the script)

local scriptDir = (script and script.dir)
  or (debug.getinfo(1, "S").source:match("^@(.*)[/\\][^/\\]*$"))
  or "."
if not package.path:find(scriptDir, 1, true) then
  package.path = scriptDir .. "/?.lua;" .. package.path
end
for name in pairs(package.loaded) do
  if name:match("^lib%.") or name:match("^games%.") then package.loaded[name] = nil end
end

local charmap = require("lib.charmap")
local textmem = require("lib.textmem")
local Transport = require("lib.transport")

-- Game plug-ins. Each exports matches(gameCode) and config(gameCode).
local GAMES = {
  require("games.emerald"),
}

local function log(msg)
  if console then console:log(msg) else print(msg) end
end

local function warn(msg)
  if console and console.warn then console:warn(msg) else log("WARNING: " .. msg) end
end

---------------------------------------------------------------------------
-- remove callbacks from a previous load of this script

if _POKELEARNING and _POKELEARNING.callbacks then
  for _, id in ipairs(_POKELEARNING.callbacks) do callbacks:remove(id) end
  if _POKELEARNING.transport then _POKELEARNING.transport:disconnect("script reloaded") end
end
_POKELEARNING = { callbacks = {} }

---------------------------------------------------------------------------
-- state

local state = {
  gameCode = nil,
  cfg = nil,
  watchers = {}, -- one per buffer, see setupWatchers()
  sources = {},  -- one per cursor source (text printed straight from ROM)
  frame = 0,
}

local function readGameCode()
  local chars = {}
  for i = 0, 3 do chars[#chars + 1] = string.char(emu:read8(0x080000AC + i)) end
  return table.concat(chars)
end

local function now()
  local ok, t = pcall(os.time)
  return ok and t * 1000 or 0
end

local transport = Transport.new({
  host = CONFIG.host,
  port = CONFIG.port,
  log = log,
  onConnect = function(t)
    t:sendFirst({
      type = "hello",
      adapter = ADAPTER,
      version = VERSION,
      game = state.cfg and state.cfg.game or "unknown",
      timestamp = now(),
    })
  end,
})
_POKELEARNING.transport = transport

local function setupWatchers()
  state.watchers = {}
  for _, buf in ipairs(state.cfg.buffers) do
    state.watchers[#state.watchers + 1] = {
      buf = buf,
      candidate = nil, stable = 0, emitted = nil, -- content debounce
      cursor = buf.cursor,  -- RAM address of the text printer's pointer into this buffer
      candidates = nil,     -- cursor discovery: { [address] = value }
      rounds = 0,
      lastPtr = nil, lastInRange = false,
      verify = nil,         -- checks left for a discovered cursor to prove itself
    }
  end
  state.sources = {}
  for _, src in ipairs(state.cfg.cursors or {}) do
    state.sources[#state.sources + 1] = { src = src, start = nil, stable = 0, emittedStart = nil }
  end
end

local function initGame()
  if not emu then return end
  state.gameCode = readGameCode()
  state.cfg = nil
  for _, g in ipairs(GAMES) do
    if g.matches(state.gameCode) then
      state.cfg = g.config(state.gameCode)
      log(string.format("[pokelearning] %s detected (game code %s, language %s)",
        g.name, state.gameCode, state.cfg.lang))
      for _, buf in ipairs(state.cfg.buffers) do
        if not buf.verified then
          warn(string.format("[pokelearning] %s buffer address 0x%08X is unverified for %s. " ..
            "If those lines don't appear, see docs/finding-addresses.md.", buf.name, buf.addr, state.gameCode))
        end
      end
      break
    end
  end
  if not state.cfg then
    warn("[pokelearning] unsupported game code '" .. state.gameCode .. "', adapter idle")
    return
  end
  setupWatchers()
end

---------------------------------------------------------------------------
-- dialogue detection

local function readBuffer(buf)
  local bytes = emu:readRange(buf.addr, buf.size)
  local stop = bytes:find("\255", 1, true)
  return stop and bytes:sub(1, stop - 1) or bytes
end

local function looksLikeText(stats)
  return stats.letters >= 2 and stats.unknown * 5 <= stats.chars
end

-- Send one piece of text. `repeated` marks a message shown again unchanged.
local function emit(source, addr, raw, repeated)
  local text, stats = charmap.decode(raw, state.cfg.lang)
  if not looksLikeText(stats) then return end
  local line = charmap.flatten(text)
  if line == "" then return end
  if CONFIG.echo then log("[" .. source .. (repeated and ", again" or "") .. "] " .. line) end
  transport:send({
    type = "line",
    adapter = ADAPTER,
    game = state.cfg.game,
    lang = state.cfg.lang,
    line = line,
    timestamp = now(),
    meta = {
      source = source,
      gameCode = state.gameCode,
      address = string.format("0x%08X", addr),
      pages = charmap.pages(text),
      repeated = repeated or nil,
    },
  })
end

-- Text printer cursor discovery. While a message prints, the game's text
-- printer keeps a pointer (currentChar) into the buffer. Each time a new
-- message appears we scan RAM for words pointing into the buffer, and keep
-- the ones whose value changed since the last message: constant pointers to
-- the buffer start drop out, the printer's cursor stays.
local function discoverCursor(w)
  local lo, hi = w.buf.addr, w.buf.addr + w.buf.size
  local now = textmem.scanPointers(lo, hi)
  if not w.candidates then
    w.candidates, w.rounds = now, 1
    return
  end
  local kept, n = {}, 0
  for addr, value in pairs(w.candidates) do
    local v = now[addr]
    if v and v ~= value then kept[addr], n = v, n + 1 end
  end
  w.rounds = w.rounds + 1
  if n == 0 then
    w.candidates, w.rounds = now, 1 -- nothing survived: start over with this message
  elseif n == 1 or w.rounds >= 4 then
    local best
    for addr in pairs(kept) do if not best or addr < best then best = addr end end
    w.cursor, w.candidates, w.verify = best, nil, nil
    log(string.format("[pokelearning] %s text printer found at 0x%08X (repeated messages are now detected)",
      w.buf.name, best))
  else
    w.candidates = kept
  end
end

local function checkWatcher(w)
  local raw = readBuffer(w.buf)

  -- 1. New content: emit once the buffer has settled.
  if raw ~= w.candidate then
    w.candidate = raw
    w.stable = 0
  elseif w.stable < CONFIG.stableFrames then
    w.stable = w.stable + 1
    if w.stable == CONFIG.stableFrames and raw ~= w.emitted then
      w.emitted = raw
      emit(w.buf.name, w.buf.addr, raw, false)
      if w.cursor then w.verify = CONFIG.cursorVerifyChecks
      elseif looksLikeText(select(2, charmap.decode(raw, state.cfg.lang))) then discoverCursor(w) end
    end
  end

  -- 2. Same content shown again: the printer cursor jumps back into the buffer.
  if not w.cursor then return end
  local ptr = emu:read32(w.cursor)
  local inRange = ptr >= w.buf.addr and ptr < w.buf.addr + w.buf.size
  if inRange and w.lastPtr and (not w.lastInRange or ptr < w.lastPtr)
      and raw == w.emitted and w.stable >= CONFIG.stableFrames then
    emit(w.buf.name, w.buf.addr, raw, true)
  end
  w.lastPtr, w.lastInRange = ptr, inRange

  if w.verify then
    if inRange then
      w.verify = nil
    else
      w.verify = w.verify - 1
      if w.verify <= 0 then
        warn(string.format("[pokelearning] %s text printer at 0x%08X stopped following messages, searching again",
          w.buf.name, w.cursor))
        w.cursor, w.verify, w.lastPtr = nil, nil, nil
      end
    end
  end
end

-- Cursor sources: a RAM word that points at the text currently being shown,
-- usually straight from ROM (item descriptions, Pokédex entries…). Emits the
-- whole string once the same one has stayed selected for a moment.
local function checkSource(s)
  local ptr = emu:read32(s.src.addr)
  local start = textmem.isRom(ptr) and textmem.printerStringStart(ptr, 1024) or nil
  if start ~= s.start then
    s.start, s.stable = start, 0
    if not start then s.emittedStart = nil end -- left the text: showing it again will emit again
    return
  end
  if not start or s.stable >= CONFIG.cursorStableChecks then return end
  s.stable = s.stable + 1
  if s.stable == CONFIG.cursorStableChecks and start ~= s.emittedStart then
    s.emittedStart = start
    emit(s.src.name, start, textmem.readString(start, 1000), false)
  end
end

local function onFrame()
  transport:tick()
  if not state.cfg then return end
  state.frame = state.frame + 1
  if state.frame % CONFIG.checkEveryFrames ~= 0 then return end
  for _, w in ipairs(state.watchers) do checkWatcher(w) end
  for _, s in ipairs(state.sources) do checkSource(s) end
end

---------------------------------------------------------------------------
-- console helpers: call these from the scripting console's input line

pokelearning = {
  -- Show what the adapter is doing.
  status = function()
    log(string.format("game %s, %s, server %s, %d queued", tostring(state.gameCode),
      state.cfg and state.cfg.game or "unsupported",
      transport:connected() and "connected" or "offline", #transport.queue))
    for _, w in ipairs(state.watchers) do
      local cursor = w.cursor and string.format("printer 0x%08X", w.cursor)
        or (w.candidates and "printer: searching" or "printer: waiting for a message")
      log(string.format("  %-7s 0x%08X  %s  buffer: %s", w.buf.name, w.buf.addr, cursor,
        w.emitted and charmap.flatten((charmap.decode(w.emitted, state.cfg.lang))) or "-"))
    end
    for _, s in ipairs(state.sources) do
      log(string.format("  %-7s cursor 0x%08X  showing: %s", s.src.name, s.src.addr,
        s.start and string.format("0x%08X", s.start) or "-"))
    end
  end,
  -- Register text printed from ROM, e.g. pokelearning.addCursor("bag", 0x0300xxxx)
  -- (find the address with tools/find_text.lua, see docs/finding-addresses.md).
  addCursor = function(name, addr)
    state.sources[#state.sources + 1] = { src = { name = name, addr = addr }, start = nil, stable = 0 }
    log(string.format("[pokelearning] watching %s text via cursor 0x%08X", name, addr))
  end,
  -- Try a new address without editing files, e.g. pokelearning.setBuffer("field", 0x02021FC4)
  setBuffer = function(name, addr, size)
    for _, w in ipairs(state.watchers) do
      if w.buf.name == name then
        w.buf.addr, w.buf.size = addr, size or w.buf.size
        w.candidate, w.stable, w.emitted = nil, 0, nil
        w.cursor, w.candidates, w.lastPtr = nil, nil, nil
        log(string.format("[pokelearning] %s buffer now at 0x%08X", name, addr))
        return
      end
    end
    warn("no buffer named " .. tostring(name))
  end,
}

---------------------------------------------------------------------------
-- wire up

local function track(id) table.insert(_POKELEARNING.callbacks, id) end
track(callbacks:add("frame", onFrame))
track(callbacks:add("start", initGame))
track(callbacks:add("reset", initGame))

log("[pokelearning] adapter " .. VERSION .. " loaded from " .. scriptDir)
if emu then initGame() else log("[pokelearning] waiting for a game to start…") end
