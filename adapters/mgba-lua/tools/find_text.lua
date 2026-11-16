-- RAM search helper for finding text buffer addresses.
--
-- Load via Tools → Scripting… → File → Load script… (can run next to main.lua),
-- then type commands into the scripting console's input line:
--
--   find("Hallo")             search EWRAM + IWRAM for this text (as Gen 3 bytes)
--   find("Hallo", true)       … and the ROM too (text printed straight from ROM)
--   findPointer(0x08123456)   list RAM words pointing into the string at this address
--   watchCursor(0x03001234)   print the string a pointer at this RAM address points into
--   watch(0x02021FC4)         print the string at this address whenever it changes
--   unwatch()                 stop all watches
--   dump(0x02021FC4, 64)      hex dump + decoded text
--   strings(30)               list every text-like string of 30+ chars in EWRAM
--
-- See docs/finding-addresses.md for the full workflow.

local here = (script and script.dir)
  or (debug.getinfo(1, "S").source:match("^@(.*)[/\\][^/\\]*$"))
  or "."
local root = here:match("^(.*)[/\\]tools$") or (here .. "/..")
if not package.path:find(root, 1, true) then
  package.path = root .. "/?.lua;" .. package.path
end
package.loaded["lib.charmap"] = nil
package.loaded["lib.textmem"] = nil
local charmap = require("lib.charmap")
local textmem = require("lib.textmem")

local REGIONS = {
  { name = "EWRAM", start = 0x02000000, size = 0x40000 },
  { name = "IWRAM", start = 0x03000000, size = 0x8000 },
}

local LANG = "de"

local function log(msg)
  if console then console:log(msg) else print(msg) end
end

local function preview(bytes, max)
  local text = charmap.flatten((charmap.decode(bytes, LANG)))
  max = max or 70
  if utf8.len(text) and utf8.len(text) > max then
    text = text:sub(1, utf8.offset(text, max + 1) - 1) .. "…"
  end
  return text
end

-- Known buffers of the running game (from games/emerald.lua), to label hits.
local function knownBuffers()
  package.loaded["games.emerald"] = nil
  local ok, emerald = pcall(require, "games.emerald")
  if not ok then return {} end
  local code = {}
  for i = 0, 3 do code[#code + 1] = string.char(emu:read8(0x080000AC + i)) end
  local cfg = emerald.config(table.concat(code))
  return cfg and cfg.buffers or {}
end

local function label(addr, buffers)
  for _, buf in ipairs(buffers) do
    if addr >= buf.addr and addr < buf.addr + buf.size then
      return string.format("  [inside %s buffer 0x%08X +%d]", buf.name, buf.addr, addr - buf.addr)
    end
  end
  return ""
end

local watches = {}

function find(text, includeRom)
  local needle, bad = charmap.encode(text, LANG)
  if not needle then
    log("find: cannot encode character '" .. tostring(bad) .. "'")
    return
  end
  local hits = 0
  local buffers = knownBuffers()
  for _, r in ipairs(REGIONS) do
    local mem = emu:readRange(r.start, r.size)
    local pos = 1
    while true do
      local s = mem:find(needle, pos, true)
      if not s then break end
      hits = hits + 1
      local addr = r.start + s - 1
      local start, found = textmem.stringStart(addr, 1000)
      log(string.format("%s hit at 0x%08X%s", r.name, addr, label(addr, buffers)))
      if found then
        log(string.format("  string starts ~0x%08X: \"%s\"", start, preview(textmem.readString(start, 300))))
      else
        log("  string start unclear (no terminator within 1000 bytes)")
      end
      log(string.format("  from hit: \"%s\"", preview(mem:sub(s, s + 300))))
      pos = s + 1
    end
  end
  if includeRom then
    local romSize, chunk = 0x02000000, 0x100000
    for off = 0, romSize - 1, chunk do
      local base = textmem.ROM_START + off
      local mem = emu:readRange(base, math.min(chunk + #needle, romSize - off))
      local pos = 1
      while true do
        local s = mem:find(needle, pos, true)
        if not s or s > chunk then break end
        hits = hits + 1
        local addr = base + s - 1
        local start = textmem.stringStart(addr, 1000)
        log(string.format("ROM hit at 0x%08X  string starts 0x%08X: \"%s\"", addr, start,
          preview(textmem.readString(start, 300))))
        log(string.format("  next: findPointer(0x%08X) while this text is on screen", start))
        pos = s + 1
      end
    end
  end
  log(string.format("find(\"%s\"): %d hit(s)", text, hits))
end

-- RAM words whose value points into the string at `addr` (a text printer's
-- cursor, while that text is on screen).
function findPointer(addr, len)
  len = len or #textmem.readString(addr, 1000) + 2
  local found, n = textmem.scanPointers(addr, addr + len), 0
  for where, value in pairs(found) do
    n = n + 1
    log(string.format("0x%08X -> 0x%08X (+%d)", where, value, value - addr))
  end
  log(string.format("findPointer(0x%08X): %d pointer(s). Try watchCursor(...) on each, then change the text on screen.", addr, n))
end

function watchCursor(where)
  local lastStart
  local id = callbacks:add("frame", function()
    local ptr = emu:read32(where)
    local start = (textmem.isRom(ptr) or textmem.isRam(ptr)) and textmem.printerStringStart(ptr, 1000) or nil
    if start ~= lastStart then
      lastStart = start
      log(string.format("[cursor 0x%08X] %s", where,
        start and string.format("0x%08X \"%s\"", start, preview(textmem.readString(start, 300), 200)) or "-"))
    end
  end)
  watches[#watches + 1] = id
  log(string.format("watching cursor 0x%08X (unwatch() to stop)", where))
end

function watch(addr, size)
  size = size or 1000
  local last
  local id = callbacks:add("frame", function()
    local bytes = emu:readRange(addr, size)
    local stop = bytes:find("\255", 1, true)
    bytes = stop and bytes:sub(1, stop - 1) or bytes
    if bytes ~= last then
      last = bytes
      log(string.format("[watch 0x%08X] %s", addr, preview(bytes, 200)))
    end
  end)
  watches[#watches + 1] = id
  log(string.format("watching 0x%08X (unwatch() to stop)", addr))
end

function unwatch()
  for _, id in ipairs(watches) do callbacks:remove(id) end
  watches = {}
  log("all watches removed")
end

function dump(addr, len)
  len = len or 64
  local bytes = emu:readRange(addr, len)
  for off = 0, len - 1, 16 do
    local hex = {}
    for i = off + 1, math.min(off + 16, len) do hex[#hex + 1] = string.format("%02X", bytes:byte(i)) end
    log(string.format("0x%08X  %-47s", addr + off, table.concat(hex, " ")))
  end
  log("decoded: " .. preview(bytes, 300))
end

function strings(minLen)
  minLen = minLen or 30
  local r = REGIONS[1]
  local mem = emu:readRange(r.start, r.size)
  local count, pos = 0, 1
  for chunk in (mem .. "\255"):gmatch("([^\255]*)\255") do
    if #chunk >= minLen then
      -- skip runs of zeros (blank memory decodes to spaces)
      local trimmed = chunk:match("^\0*(.-)$")
      local text, stats = charmap.decode(trimmed, LANG)
      if stats.letters >= minLen / 2 and stats.unknown * 10 <= stats.chars then
        count = count + 1
        log(string.format("0x%08X  %s", r.start + pos - 1 + (#chunk - #trimmed),
          preview(trimmed, 90)))
      end
    end
    pos = pos + #chunk + 1
  end
  log(string.format("strings(%d): %d candidate(s)", minLen, count))
end

log("[find_text] ready: find(\"text\"[, true]), findPointer(addr), watchCursor(addr), watch(addr), unwatch(), dump(addr, len), strings(minLen)")
