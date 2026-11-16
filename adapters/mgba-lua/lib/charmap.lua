-- Gen 3 (Ruby/Sapphire/Emerald, international releases) character encoding.
-- Transcribed from pret/pokeemerald charmap.txt (Latin table only).
-- decode() turns raw game bytes into UTF-8; encode() does the reverse for RAM searches.

local M = {}

M.EOS       = 0xFF -- end of string
M.NEWLINE   = 0xFE -- \n
M.PARAGRAPH = 0xFB -- \p  (wait for button, clear box)
M.SCROLL    = 0xFA -- \l  (wait for button, scroll one line)
M.EXT_CTRL  = 0xFC -- extended control code, followed by sub-code + args
M.PLACEHOLDER = 0xFD -- e.g. FD 01 = player name (expanded before printing)
M.DYNAMIC   = 0xF7 -- followed by 1 byte
M.KEYPAD    = 0xF8 -- followed by 1 byte (button icon)
M.SYMBOL    = 0xF9 -- followed by 1 byte (extra symbol)

local base = {
  [0x00] = " ",
  [0x01] = "À", [0x02] = "Á", [0x03] = "Â", [0x04] = "Ç", [0x05] = "È", [0x06] = "É",
  [0x07] = "Ê", [0x08] = "Ë", [0x09] = "Ì", [0x0B] = "Î", [0x0C] = "Ï", [0x0D] = "Ò",
  [0x0E] = "Ó", [0x0F] = "Ô", [0x10] = "Œ", [0x11] = "Ù", [0x12] = "Ú", [0x13] = "Û",
  [0x14] = "Ñ", [0x15] = "ß", [0x16] = "à", [0x17] = "á", [0x19] = "ç", [0x1A] = "è",
  [0x1B] = "é", [0x1C] = "ê", [0x1D] = "ë", [0x1E] = "ì", [0x20] = "î", [0x21] = "ï",
  [0x22] = "ò", [0x23] = "ó", [0x24] = "ô", [0x25] = "œ", [0x26] = "ù", [0x27] = "ú",
  [0x28] = "û", [0x29] = "ñ", [0x2A] = "º", [0x2B] = "ª", [0x2C] = "er", [0x2D] = "&",
  [0x2E] = "+", [0x34] = "Lv", [0x35] = "=", [0x36] = ";",
  [0x51] = "¿", [0x52] = "¡", [0x53] = "PK", [0x54] = "MN", [0x5A] = "Í", [0x5B] = "%",
  [0x5C] = "(", [0x5D] = ")", [0x68] = "â", [0x6F] = "í",
  [0x79] = "↑", [0x7A] = "↓", [0x7B] = "←", [0x7C] = "→",
  [0x84] = "e", [0x85] = "<", [0x86] = ">", [0xA0] = "re",
  [0xA1] = "0", [0xA2] = "1", [0xA3] = "2", [0xA4] = "3", [0xA5] = "4",
  [0xA6] = "5", [0xA7] = "6", [0xA8] = "7", [0xA9] = "8", [0xAA] = "9",
  [0xAB] = "!", [0xAC] = "?", [0xAD] = ".", [0xAE] = "-", [0xAF] = "·", [0xB0] = "…",
  [0xB1] = "“", [0xB2] = "”", [0xB3] = "‘", [0xB4] = "’", [0xB5] = "♂", [0xB6] = "♀",
  [0xB7] = "¥", [0xB8] = ",", [0xB9] = "×", [0xBA] = "/",
  [0xEF] = "▶", [0xF0] = ":",
  [0xF1] = "Ä", [0xF2] = "Ö", [0xF3] = "Ü", [0xF4] = "ä", [0xF5] = "ö", [0xF6] = "ü",
}
for i = 0, 25 do
  base[0xBB + i] = string.char(65 + i) -- A-Z
  base[0xD5 + i] = string.char(97 + i) -- a-z
end

-- Language-specific glyph differences. The German font draws the quote bytes
-- as German quotation marks (confirmed in Smaragd). French is unverified.
local overrides = {
  de = { [0xB1] = "„", [0xB2] = "“" },
  fr = { [0xB1] = "«", [0xB2] = "»" },
}

-- Total length (sub-code + args) of each FC sub-code, from pokeemerald text.c.
local extCtrlLength = {
  [0x00] = 1, [0x01] = 2, [0x02] = 2, [0x03] = 2, [0x04] = 4, [0x05] = 2,
  [0x06] = 2, [0x07] = 1, [0x08] = 2, [0x09] = 1, [0x0A] = 1, [0x0B] = 3,
  [0x0C] = 2, [0x0D] = 2, [0x0E] = 2, [0x0F] = 1, [0x10] = 3, [0x11] = 2,
  [0x12] = 2, [0x13] = 2, [0x14] = 2, [0x15] = 1, [0x16] = 1, [0x17] = 1,
  [0x18] = 1,
}

local placeholders = {
  [0x01] = "PLAYER", [0x02] = "STR_VAR_1", [0x03] = "STR_VAR_2", [0x04] = "STR_VAR_3",
  [0x05] = "KUN", [0x06] = "RIVAL", [0x07] = "VERSION", [0x08] = "AQUA", [0x09] = "MAGMA",
  [0x0A] = "ARCHIE", [0x0B] = "MAXIE", [0x0C] = "KYOGRE", [0x0D] = "GROUDON",
}

local function tableFor(lang)
  local t = {}
  for k, v in pairs(base) do t[k] = v end
  for k, v in pairs(overrides[lang] or {}) do t[k] = v end
  return t
end

local cache = {}
local function getTable(lang)
  lang = lang or "en"
  if not cache[lang] then cache[lang] = tableFor(lang) end
  return cache[lang]
end

-- Decode a byte string up to the first EOS.
-- Returns: text (with "\n" for line breaks and "\f" for paragraph breaks), stats.
-- stats = { chars = n printable glyphs, letters = n, unknown = n unmapped bytes, length = bytes consumed }
function M.decode(bytes, lang)
  local map = getTable(lang)
  local out = {}
  local stats = { chars = 0, letters = 0, unknown = 0, length = 0 }
  local i, n = 1, #bytes
  while i <= n do
    local b = bytes:byte(i)
    if b == M.EOS then
      break
    elseif b == M.NEWLINE or b == M.SCROLL then
      out[#out + 1] = "\n"
      i = i + 1
    elseif b == M.PARAGRAPH then
      out[#out + 1] = "\f"
      i = i + 1
    elseif b == M.EXT_CTRL then
      local sub = bytes:byte(i + 1) or 0
      i = i + 1 + (extCtrlLength[sub] or 1)
    elseif b == M.PLACEHOLDER then
      local sub = bytes:byte(i + 1) or 0
      out[#out + 1] = "{" .. (placeholders[sub] or string.format("FD_%02X", sub)) .. "}"
      i = i + 2
    elseif b == M.DYNAMIC or b == M.KEYPAD or b == M.SYMBOL then
      i = i + 2
    else
      local ch = map[b]
      if ch then
        out[#out + 1] = ch
        stats.chars = stats.chars + 1
        if (b >= 0xBB and b <= 0xEE) or (b >= 0xF1 and b <= 0xF6) or b == 0x15 or (b >= 0x01 and b <= 0x29) then
          stats.letters = stats.letters + 1
        end
      else
        out[#out + 1] = string.format("[%02X]", b)
        stats.unknown = stats.unknown + 1
      end
      i = i + 1
    end
  end
  stats.length = i - 1
  return table.concat(out), stats
end

-- Encode a UTF-8 string into game bytes (no terminator). Returns nil + char on failure.
function M.encode(text, lang)
  local map = getTable(lang)
  local reverse = {}
  for byte, ch in pairs(map) do
    -- prefer single-glyph entries; multi-letter ones (PK, Lv, er…) are not searchable
    if utf8.len(ch) == 1 and (reverse[ch] == nil or byte > reverse[ch]) then
      reverse[ch] = byte
    end
  end
  reverse[" "] = 0x00
  reverse["'"] = 0xB4
  reverse["\n"] = M.NEWLINE
  local out = {}
  for _, cp in utf8.codes(text) do
    local ch = utf8.char(cp)
    local b = reverse[ch]
    if not b then return nil, ch end
    out[#out + 1] = string.char(b)
  end
  return table.concat(out)
end

-- Turn decoded text into one flat sentence-ish line for the learning pipeline.
-- "Pokémon-\nCenter" keeps its hyphen; other breaks become single spaces.
function M.flatten(text)
  local s = text:gsub("%-[\n\f]", "-"):gsub("[\n\f]", " "):gsub("%s+", " ")
  return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

-- Split decoded text into pages (\p) of lines (\n).
function M.pages(text)
  local pages = {}
  for page in (text .. "\f"):gmatch("(.-)\f") do
    if page:match("%S") then pages[#pages + 1] = page end
  end
  return pages
end

return M
