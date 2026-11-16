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
  watchers = {}, -- one per buffer: { buf, candidate, stable, emitted }
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
    state.watchers[#state.watchers + 1] = { buf = buf, candidate = nil, stable = 0, emitted = nil }
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

local function emit(w, raw)
  local text, stats = charmap.decode(raw, state.cfg.lang)
  if not looksLikeText(stats) then return end
  local line = charmap.flatten(text)
  if line == "" then return end
  if CONFIG.echo then log("[" .. w.buf.name .. "] " .. line) end
  transport:send({
    type = "line",
    adapter = ADAPTER,
    game = state.cfg.game,
    lang = state.cfg.lang,
    line = line,
    timestamp = now(),
    meta = {
      source = w.buf.name,
      gameCode = state.gameCode,
      address = string.format("0x%08X", w.buf.addr),
      pages = charmap.pages(text),
    },
  })
end

local function checkBuffers()
  for _, w in ipairs(state.watchers) do
    local raw = readBuffer(w.buf)
    if raw ~= w.candidate then
      w.candidate = raw
      w.stable = 0
    elseif w.stable < CONFIG.stableFrames then
      w.stable = w.stable + 1
      if w.stable == CONFIG.stableFrames and raw ~= w.emitted then
        w.emitted = raw
        emit(w, raw)
      end
    end
  end
end

local function onFrame()
  transport:tick()
  if not state.cfg then return end
  state.frame = state.frame + 1
  if state.frame % CONFIG.checkEveryFrames == 0 then checkBuffers() end
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
      log(string.format("  %-7s 0x%08X  buffer: %s", w.buf.name, w.buf.addr,
        w.emitted and charmap.flatten((charmap.decode(w.emitted, state.cfg.lang))) or "-"))
    end
  end,
  -- Try a new address without editing files, e.g. pokelearning.setBuffer("field", 0x02021FC4)
  setBuffer = function(name, addr, size)
    for _, w in ipairs(state.watchers) do
      if w.buf.name == name then
        w.buf.addr, w.buf.size = addr, size or w.buf.size
        w.candidate, w.stable, w.emitted = nil, 0, nil
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
