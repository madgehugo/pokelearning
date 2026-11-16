-- Menus: text drawn straight from ROM.
--
-- Menus aren't built in the dialogue buffers; the game draws their strings from
-- ROM through AddTextPrinter. A breakpoint on it (address in the game's config)
-- calls onPrint() for every string drawn. They are collected, and once the screen
-- has stopped drawing, flush() hands back all of them as one "menu" line (one
-- item per line).

local charmap = require("lib.charmap")
local textmem = require("lib.textmem")

local M = {}
M.__index = M

M.QUIET_FRAMES = 15 -- ~0.25 s without a new string
M.MAX_ITEMS = 24

-- Finding AddTextPrinter. Games list its address in their config when it is known (checked
-- against the function's first bytes). Otherwise it's found by the start of its code, which
-- the compiler produces from the same source in every Gen 3 game: push {r4-r7,lr};
-- adds r6,r0,#0; mov ip,r2; lsls r1,r1,#24; lsrs r5,r1,#24 — then ldr r0,[pc,#n]; ldr r0,[r0]; cmp r0,#0.
local SIGNATURE_HEAD = "\xF0\xB5\x06\x1C\x94\x46\x09\x06\x0D\x0E"
local SIGNATURE_TAIL = "\x48\x00\x68\x00\x28" -- after one byte of pc-relative offset
local SCAN_BYTES = 0x100000 -- the text code is in the first megabyte of the ROM
local SCAN_CHUNK = 0x10000

-- Addresses in [from, from + size) where the signature matches.
function M.findPrinters(from, size)
  local found = {}
  local head, tail = SIGNATURE_HEAD, SIGNATURE_TAIL
  local span = #head + 1 + #tail
  for offset = 0, size - 1, SCAN_CHUNK do
    local len = math.min(SCAN_CHUNK + span - 1, size - offset)
    local bytes = emu:readRange(from + offset, len)
    local pos = 1
    while true do
      local at = bytes:find(head, pos, true)
      if not at then break end
      -- matches that start in the overlap belong to the next chunk
      if at <= SCAN_CHUNK and bytes:sub(at + #head + 1, at + #head + #tail) == tail then
        found[#found + 1] = from + offset + at - 1
      end
      pos = at + 1
    end
  end
  return found
end

-- The address of AddTextPrinter, or nil and the reason it wasn't found.
-- `printer` is the game's config entry { addr, bytes }, if it has one.
function M.locatePrinter(printer, from, size)
  if printer and emu:readRange(printer.addr, #printer.bytes) == printer.bytes then return printer.addr end
  local found = M.findPrinters(from or 0x08000000, size or SCAN_BYTES)
  if #found == 1 then return found[1] end
  return nil, #found == 0 and "not found" or "found more than once"
end

function M.new(lang)
  return setmetatable({ lang = lang, items = {}, seen = {}, address = nil, lastFrame = 0, lastSent = nil }, M)
end

local function looksLikeText(stats)
  return stats.letters >= 2 and stats.unknown * 5 <= stats.chars
end

-- Breakpoint callback: r0 = the text printer's template (its first word is the
-- string pointer), r1 = the print speed.
function M:onPrint(frame)
  if #self.items >= M.MAX_ITEMS then return end
  local template = emu:readRegister("r0")
  if not textmem.isRam(template) then return end
  local ptr = emu:read32(template)
  -- Dialogue is printed letter by letter (speed 1-3) and read from its buffer instead.
  -- Labels print at once (speed 0 or 0xFF); some are built in RAM first (the Continue
  -- screen's SPIELER, ORDEN…), so those are read at the moment they're drawn.
  local speed = emu:readRegister("r1") & 0xFF
  local instant = speed == 0 or speed == 0xFF
  if not (textmem.isRom(ptr) or (instant and textmem.isRam(ptr))) then return end
  local raw = textmem.readString(ptr, 200)
  if self.seen[raw] then return end
  self.seen[raw] = true
  local text, stats = charmap.decode(raw, self.lang)
  if not looksLikeText(stats) then return end
  local flat = charmap.flatten(text)
  if flat ~= "" then
    self.items[#self.items + 1] = flat
    self.address = self.address or ptr
  end
  self.lastFrame = frame
end

-- Once the screen has settled: the collected items as one text, plus the address
-- of the first one. Returns nil while still drawing, when nothing was drawn, or
-- when it is the same screen as the last one (redrawn).
function M:flush(frame)
  if #self.items == 0 or frame - self.lastFrame < M.QUIET_FRAMES then return nil end
  local text, address = table.concat(self.items, "\n"), self.address
  self.items, self.seen, self.address = {}, {}, nil
  if text == self.lastSent then return nil end
  self.lastSent = text
  return text, address
end

return M
