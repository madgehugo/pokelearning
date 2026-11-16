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
