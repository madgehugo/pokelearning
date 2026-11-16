-- Memory helpers for text: GBA memory regions, pointer scans, and finding the
-- start of an 0xFF-terminated string from a pointer into its middle.

local M = {}

M.EWRAM = { name = "EWRAM", start = 0x02000000, size = 0x40000 }
M.IWRAM = { name = "IWRAM", start = 0x03000000, size = 0x8000 }
M.RAM_REGIONS = { M.EWRAM, M.IWRAM }

M.ROM_START, M.ROM_END = 0x08000000, 0x0A000000

function M.isRom(addr) return addr >= M.ROM_START and addr < M.ROM_END end
function M.isRam(addr)
  return (addr >= M.EWRAM.start and addr < M.EWRAM.start + M.EWRAM.size)
      or (addr >= M.IWRAM.start and addr < M.IWRAM.start + M.IWRAM.size)
end

-- All 4-byte-aligned words in RAM whose value lies in [lo, hi).
-- Returns { [address] = value }.
function M.scanPointers(lo, hi)
  local found = {}
  for _, r in ipairs(M.RAM_REGIONS) do
    local mem = emu:readRange(r.start, r.size)
    for i = 1, #mem - 3, 4 do
      local v = string.unpack("<I4", mem, i)
      if v >= lo and v < hi then found[r.start + i - 1] = v end
    end
  end
  return found
end

-- Start of the string that `ptr` points into: the byte after the previous
-- 0xFF terminator, or after a run of 4+ identical bytes (padding or blank
-- memory, which real text practically never contains). Looks back at most
-- `maxBack` bytes. Returns start, found (false if neither boundary was seen).
function M.stringStart(ptr, maxBack)
  maxBack = maxBack or 1024
  local from = ptr - maxBack
  if from >= ptr then return ptr, true end
  local bytes = emu:readRange(from, ptr - from)
  for i = #bytes, 1, -1 do
    local b = bytes:byte(i)
    if b == 0xFF then return from + i, true end
    if i > 3 and bytes:byte(i - 1) == b and bytes:byte(i - 2) == b and bytes:byte(i - 3) == b then
      return from + i, true
    end
  end
  return from, false
end

-- Start of the string a text printer's cursor belongs to. A finished printer's
-- cursor points one past the string's 0xFF terminator (pokeemerald increments
-- currentChar before checking for EOS), so a preceding 0xFF means "just ended".
function M.printerStringStart(ptr, maxBack)
  if emu:read8(ptr - 1) == 0xFF then ptr = ptr - 1 end
  return M.stringStart(ptr, maxBack)
end

-- Raw bytes of the string at `addr`, up to (not including) the 0xFF terminator.
function M.readString(addr, maxLen)
  local bytes = emu:readRange(addr, maxLen or 1000)
  local stop = bytes:find("\255", 1, true)
  return stop and bytes:sub(1, stop - 1) or bytes
end

return M
