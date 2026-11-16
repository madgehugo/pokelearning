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
local Discovery = require("lib.discover")
local Menu = require("lib.menu")
local textmem = require("lib.textmem")
local Transport = require("lib.transport")

-- Game plug-ins. Each exports matches(gameCode) and config(gameCode).
local GAMES = {
  require("games.gen3"),
}

-- Looking for text buffers takes a full EWRAM read, so only every so often.
local DISCOVER_EVERY_FRAMES = 30

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
  if emu and emu.clearBreakpoint then
    for _, id in ipairs(_POKELEARNING.breakpoints or {}) do pcall(emu.clearBreakpoint, emu, id) end
  end
  if _POKELEARNING.transport then _POKELEARNING.transport:disconnect("script reloaded") end
end
_POKELEARNING = { callbacks = {}, breakpoints = {} }

---------------------------------------------------------------------------
-- state

local state = {
  gameCode = nil,
  cfg = nil,
  watchers = {}, -- one per buffer, see setupWatchers()
  sources = {},  -- one per cursor source (text printed straight from ROM)
  discovery = nil, -- finds text buffers when the game's addresses aren't known
  frame = 0,
  menu = nil, -- collects strings the game drew from ROM (menus), see lib/menu.lua
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

local function addWatcher(buf)
  state.watchers[#state.watchers + 1] = {
    buf = buf,
    candidate = nil, stable = 0, emitted = nil, -- content debounce
    cursor = buf.cursor,  -- RAM address of the text printer's pointer into this buffer
    track = nil,          -- cursor discovery for the current message, see trackStep()
    evidence = {},        -- { [address] = messages in which it moved forward }
    verify = nil,         -- a known cursor must keep moving on new messages
    missed = 0,
    lastPtr = nil, lastInRange = false,
    seen = {}, seenCount = 0, -- texts already sent this session
  }
end

local function setupWatchers()
  state.watchers = {}
  for _, buf in ipairs(state.cfg.buffers) do addWatcher(buf) end
  state.discovery = state.cfg.discover and Discovery.new(state.cfg.lang) or nil
  state.sources = {}
  for _, src in ipairs(state.cfg.cursors or {}) do
    state.sources[#state.sources + 1] = { src = src, start = nil, stable = 0, emittedStart = nil }
  end
end

local function looksLikeText(stats)
  return stats.letters >= 2 and stats.unknown * 5 <= stats.chars
end

---------------------------------------------------------------------------
-- menus: text drawn straight from ROM (see lib/menu.lua)

local function setupMenuHook()
  state.menu = nil
  local printer = state.cfg.printer
  if not printer then return end
  if not (emu.setBreakpoint and emu.readRegister) then
    warn("[pokelearning] this mGBA can't watch menus (it needs scripting breakpoints: use the app's mGBA)")
    return
  end
  if emu:readRange(printer.addr, #printer.bytes) ~= printer.bytes then
    warn("[pokelearning] the text printer isn't at the expected address in this ROM, menus won't be translated")
    return
  end
  local menu = Menu.new(state.cfg.lang)
  local ok, id = pcall(emu.setBreakpoint, emu, function() menu:onPrint(state.frame) end, printer.addr)
  if ok then
    state.menu = menu
    table.insert(_POKELEARNING.breakpoints, id)
  else
    warn("[pokelearning] couldn't watch menus: " .. tostring(id))
  end
end

local function flushMenu()
  if not state.menu then return end
  local text, address = state.menu:flush(state.frame)
  if not text then return end
  if CONFIG.echo then log("[menu] " .. text:gsub("\n", " | ")) end
  transport:send({
    type = "line",
    adapter = ADAPTER,
    game = state.cfg.game,
    lang = state.cfg.lang,
    line = text,
    timestamp = now(),
    meta = { source = "menu", gameCode = state.gameCode, address = string.format("0x%08X", address) },
  })
end

local function initGame()
  if not emu then return end
  state.gameCode = readGameCode()
  state.cfg = nil
  for _, g in ipairs(GAMES) do
    if g.matches(state.gameCode) then
      state.cfg = g.config(state.gameCode)
      log(string.format("[pokelearning] %s detected (game code %s, language %s)",
        state.cfg.title or g.name, state.gameCode, state.cfg.lang))
      if state.cfg.discover then
        log("[pokelearning] text buffer addresses for this game aren't known yet: they're found while you play. " ..
          "Talk to a few people; the first lines appear after about three messages.")
      end
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
  setupMenuHook()
end

---------------------------------------------------------------------------
-- dialogue detection

local function readBuffer(buf)
  local bytes = emu:readRange(buf.addr, buf.size)
  local stop = bytes:find("\255", 1, true)
  return stop and bytes:sub(1, stop - 1) or bytes
end

-- Send one piece of text. `again` only labels the console echo (the server
-- counts repeats itself, across sessions).
local function emit(source, addr, raw, again)
  local text, stats = charmap.decode(raw, state.cfg.lang)
  if not looksLikeText(stats) then return end
  local line = charmap.flatten(text)
  if line == "" then return end
  if CONFIG.echo then log("[" .. source .. (again and ", again" or "") .. "] " .. line) end
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
    },
  })
end

-- Text printer cursor discovery. While a message prints, the game's text
-- printer keeps a pointer (currentChar) into the buffer that moves forward
-- one character at a time. Other RAM words can point into the buffer too
-- (leftovers on the stack from building the message), but they stay put.
-- So for the first frames of each new message we follow every word pointing
-- into the buffer; one that moves forward in two messages is the cursor.
local TRACK_CHECKS = 20  -- ~40 frames per message
local MAX_TRACKED = 256
local MAX_SEEN = 500

local function inBuffer(w, v) return v >= w.buf.addr and v < w.buf.addr + w.buf.size end

local function addTrackedPointers(w)
  local t = w.track
  for addr, v in pairs(textmem.scanPointers(w.buf.addr, w.buf.addr + w.buf.size)) do
    if not t.ptrs[addr] and t.n < MAX_TRACKED then
      t.ptrs[addr], t.n = { last = v, moves = 0 }, t.n + 1
    end
  end
end

local function finishTracking(w)
  local best, bestMoves = nil, 1 -- must move forward at least twice
  for addr, p in pairs(w.track.ptrs) do
    if p.moves > bestMoves or (p.moves == bestMoves and best and addr < best) then
      best, bestMoves = addr, p.moves
    end
  end
  w.track = nil
  if not best then return end
  w.evidence[best] = (w.evidence[best] or 0) + 1
  if w.evidence[best] >= 2 then
    w.cursor, w.evidence, w.missed = best, {}, 0
    log(string.format("[pokelearning] %s text printer found at 0x%08X (repeated messages are now detected)",
      w.buf.name, best))
  end
end

-- One check of discovery (no cursor yet) or verification (cursor known).
local function trackStep(w)
  if w.track then
    local t = w.track
    t.checks = t.checks + 1
    -- the printer may start a moment after the text lands in the buffer
    if t.checks == 2 or t.checks == 4 then addTrackedPointers(w) end
    for addr, p in pairs(t.ptrs) do
      local v = emu:read32(addr)
      if inBuffer(w, v) then
        if v > p.last then p.moves = p.moves + 1 end
        p.last = v
      else
        t.ptrs[addr], t.n = nil, t.n - 1
      end
    end
    if t.checks >= TRACK_CHECKS then finishTracking(w) end
  elseif w.verify then
    local v = w.verify
    v.checks = v.checks + 1
    local ptr = emu:read32(w.cursor)
    if inBuffer(w, ptr) and v.last and ptr > v.last then v.moved = true end
    v.last = ptr
    if v.checks >= TRACK_CHECKS then
      w.verify = nil
      w.missed = v.moved and 0 or w.missed + 1
      if w.missed >= 3 then
        warn(string.format("[pokelearning] %s text printer at 0x%08X stopped following messages, searching again",
          w.buf.name, w.cursor))
        w.cursor, w.lastPtr, w.missed = nil, nil, 0
      end
    end
  end
end

-- Called when new content lands in the buffer.
local function onNewContent(w)
  if w.cursor then
    w.verify = { checks = 0, last = nil, moved = false }
  else
    w.track = { checks = 0, ptrs = {}, n = 0 }
    addTrackedPointers(w)
  end
end

-- Send buffer text; the console echo says "again" if it was already sent this session.
local function emitBuffer(w, raw, shownAgain)
  local again = shownAgain or w.seen[raw] ~= nil
  emit(w.buf.name, w.buf.addr, raw, again)
  if not w.seen[raw] then
    if w.seenCount >= MAX_SEEN then w.seen, w.seenCount = {}, 0 end
    w.seen[raw], w.seenCount = true, w.seenCount + 1
  end
end

local function checkWatcher(w)
  local raw = readBuffer(w.buf)

  -- 1. New content: emit once the buffer has settled.
  if raw ~= w.candidate then
    w.candidate = raw
    w.stable = 0
    onNewContent(w)
  elseif w.stable < CONFIG.stableFrames then
    w.stable = w.stable + 1
    if w.stable == CONFIG.stableFrames and raw ~= w.emitted then
      w.emitted = raw
      emitBuffer(w, raw, false)
    end
  end
  trackStep(w)

  -- 2. Same content shown again: the printer cursor jumps back into the buffer.
  if not w.cursor then return end
  local ptr = emu:read32(w.cursor)
  local inRange = inBuffer(w, ptr)
  if inRange and w.lastPtr and (not w.lastInRange or ptr < w.lastPtr)
      and raw == w.emitted and w.stable >= CONFIG.stableFrames then
    emitBuffer(w, raw, true)
    w.verify = { checks = 0, last = nil, moved = false }
  end
  w.lastPtr, w.lastInRange = ptr, inRange
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
  flushMenu()
  if state.discovery and state.frame % DISCOVER_EVERY_FRAMES == 0 then
    local buf = state.discovery:step()
    if buf then
      buf.name = #state.watchers == 0 and "field" or ("text" .. (#state.watchers + 1))
      addWatcher(buf)
      log(string.format("[pokelearning] found a text buffer at 0x%08X (%s). To skip the search next time, add " ..
        "{ name = \"%s\", addr = 0x%08X, size = %d, verified = true } for %s to a games/ file.",
        buf.addr, buf.name, buf.name, buf.addr, buf.size, state.gameCode))
    end
  end
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
      local cursor
      if w.cursor then
        cursor = string.format("printer 0x%08X", w.cursor)
      else
        local clues = {}
        for addr, n in pairs(w.evidence) do clues[#clues + 1] = string.format("0x%08X×%d", addr, n) end
        cursor = "printer: searching" .. (w.track and string.format(" (following %d pointers)", w.track.n) or "")
          .. (#clues > 0 and (", candidates " .. table.concat(clues, " ")) or "")
      end
      log(string.format("  %-7s 0x%08X  %s  buffer: %s", w.buf.name, w.buf.addr, cursor,
        w.emitted and charmap.flatten((charmap.decode(w.emitted, state.cfg.lang))) or "-"))
    end
    for _, s in ipairs(state.sources) do
      log(string.format("  %-7s cursor 0x%08X  showing: %s", s.src.name, s.src.addr,
        s.start and string.format("0x%08X", s.start) or "-"))
    end
    if state.discovery then
      local top = {}
      for i, c in ipairs(state.discovery:summary()) do
        if i > 3 then break end
        top[#top + 1] = string.format("0x%08X (%d of 3 messages)", c.addr, c.distinct)
      end
      log("  searching for text buffers" .. (#top > 0 and (": " .. table.concat(top, ", ")) or ": no candidates yet"))
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
        w.cursor, w.track, w.evidence, w.verify, w.lastPtr = nil, nil, {}, nil, nil
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
