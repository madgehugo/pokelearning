-- Text buffer discovery for games whose addresses aren't known yet.
--
-- Every message the game shows is written to a buffer in RAM (pokeemerald:
-- gStringVar4 for field text, gDisplayedStringBattle in battle) before it is
-- printed. Every half second we look at what changed in EWRAM and decode the
-- 0xFF-terminated strings there. A buffer is a start address where new,
-- sentence-like text keeps appearing: after three different messages it is
-- adopted and watched like a configured buffer.

local charmap = require("lib.charmap")
local textmem = require("lib.textmem")

local M = {}
M.__index = M

local PAGE = 0x1000
local REGION = textmem.EWRAM
local NEEDED = 3        -- different messages before a buffer is adopted
local MIN_LETTERS = 12  -- "sentence-like": enough letters…
local MIN_SPACES = 2    -- …and words
local MAX_TRACKED = 200

function M.new(lang)
  return setmetatable({ lang = lang, snapshot = nil, candidates = {}, count = 0, adopted = {} }, M)
end

local function looksLikeSentence(raw, lang)
  local _, stats = charmap.decode(raw, lang)
  local spaces = select(2, raw:gsub("\0", ""))
  return stats.letters >= MIN_LETTERS and spaces >= MIN_SPACES and stats.unknown * 10 <= stats.chars
end

-- In a buffer we already adopted (its start, or stale tails of longer messages
-- further in): not a new buffer.
function M:insideAdopted(addr)
  for _, a in ipairs(self.adopted) do
    if addr >= a.addr and addr < a.addr + a.size then return true end
  end
  return false
end

-- Field and battle text are the two buffers that matter; stop looking after a few.
local MAX_BUFFERS = 4
function M:done() return #self.adopted >= MAX_BUFFERS end

-- Offset where the text in a 0xFF-delimited chunk starts: after the last run of
-- 4+ identical bytes (blank memory between variables decodes as spaces, and real
-- text practically never repeats a byte four times).
local function textStart(raw)
  local start = 1
  local i = 1
  while i <= #raw - 3 do
    local b = raw:byte(i)
    local j = i + 1
    while j <= #raw and raw:byte(j) == b do j = j + 1 end
    if j - i >= 4 then start = j end
    i = j
  end
  return start
end

-- Strings (start offset, bytes) that overlap the byte range [from, to) of `mem`.
local function stringsOverlapping(mem, from, to)
  local out = {}
  local pos = from
  -- back up to the start of the string the range begins in
  while pos > 1 and mem:byte(pos - 1) ~= 0xFF and from - pos < 1000 do pos = pos - 1 end
  while pos < to do
    local stop = mem:find("\255", pos, true)
    if not stop then break end
    if stop > pos then
      local chunk = mem:sub(pos, stop - 1)
      local s = textStart(chunk)
      if s <= #chunk then out[#out + 1] = { pos + s - 1, chunk:sub(s) } end
    end
    pos = stop + 1
  end
  return out
end

-- Look at RAM once. Returns a newly adopted buffer { addr, size } or nil.
function M:step()
  if self:done() then return nil end
  local mem = emu:readRange(REGION.start, REGION.size)
  local prev = self.snapshot
  self.snapshot = mem
  if not prev then return nil end

  for p = 1, #mem, PAGE do
    local last = math.min(p + PAGE - 1, #mem)
    if mem:sub(p, last) ~= prev:sub(p, last) then
      for _, s in ipairs(stringsOverlapping(mem, p, last + 1)) do
        local offset, raw = s[1], s[2]
        local addr = REGION.start + offset - 1
        if #raw <= 1000 and not self:insideAdopted(addr) and looksLikeSentence(raw, self.lang) then
          local c = self.candidates[addr]
          if not c then
            if self.count < MAX_TRACKED then
              self.candidates[addr] = { seen = { [raw] = true }, distinct = 1 }
              self.count = self.count + 1
            end
          elseif not c.seen[raw] then
            c.seen[raw] = true
            c.distinct = c.distinct + 1
            if c.distinct >= NEEDED then return self:adopt(addr) end
          end
        end
      end
    end
  end
  return nil
end

function M:adopt(addr)
  local buf = { addr = addr, size = 1000 }
  -- don't let a buffer run into another one we already know
  for _, a in ipairs(self.adopted) do
    if a.addr > addr and a.addr - addr < buf.size then buf.size = a.addr - addr end
  end
  self.adopted[#self.adopted + 1] = buf
  -- forget candidates inside the new buffer (tails of its messages)
  for a in pairs(self.candidates) do
    if a > addr and a < addr + buf.size then self.candidates[a], self.count = nil, self.count - 1 end
  end
  self.candidates[addr] = nil
  return buf
end

-- Candidates for the console: { { addr, distinct }, … } sorted by messages seen.
function M:summary()
  local list = {}
  for addr, c in pairs(self.candidates) do list[#list + 1] = { addr = addr, distinct = c.distinct } end
  table.sort(list, function(a, b) return a.distinct > b.distinct end)
  return list
end

return M
