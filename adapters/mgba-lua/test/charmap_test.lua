local h = require("harness")
local charmap = require("lib.charmap")

local function bytes(...) return string.char(...) end

h.test("charmap: decodes letters, spaces and stops at EOS", function()
  -- "Hi A" + EOS + junk
  local text, stats = charmap.decode(bytes(0xC2, 0xDD, 0x00, 0xBB, 0xFF, 0xBC))
  h.eq(text, "Hi A")
  h.eq(stats.chars, 4)
  h.eq(stats.letters, 3)
  h.eq(stats.length, 4)
end)

h.test("charmap: German umlauts and ß", function()
  local text = charmap.decode(bytes(0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0x15, 0xFF), "de")
  h.eq(text, "ÄÖÜäöüß")
end)

h.test("charmap: quotes differ by language", function()
  local raw = bytes(0xB1, 0xB2, 0xFF)
  h.eq(charmap.decode(raw, "en"), "“”")
  h.eq(charmap.decode(raw, "de"), "„“")
  h.eq(charmap.decode(raw, "fr"), "«»")
end)

h.test("charmap: newline, scroll and paragraph codes", function()
  local text = charmap.decode(bytes(0xBB, 0xFE, 0xBC, 0xFA, 0xBD, 0xFB, 0xBE, 0xFF))
  h.eq(text, "A\nB\nC\fD")
end)

h.test("charmap: placeholders are named, unknown ones are hex", function()
  h.eq(charmap.decode(bytes(0xFD, 0x01, 0xFF)), "{PLAYER}")
  h.eq(charmap.decode(bytes(0xFD, 0x7F, 0xFF)), "{FD_7F}")
end)

h.test("charmap: extended control codes skip their arguments", function()
  -- FC 01 <color>: 2 bytes after FC, then "A"
  h.eq(charmap.decode(bytes(0xFC, 0x01, 0x05, 0xBB, 0xFF)), "A")
  -- FC 04 has 4 bytes
  h.eq(charmap.decode(bytes(0xFC, 0x04, 1, 2, 3, 0xBB, 0xFF)), "A")
end)

h.test("charmap: unmapped bytes are counted and shown", function()
  local t2, s2 = charmap.decode(bytes(0xBB, 0x0A, 0xFF))
  h.eq(t2, "A[0A]")
  h.eq(s2.unknown, 1)
end)

h.test("charmap: truncated control code at end of buffer doesn't crash", function()
  charmap.decode(bytes(0xBB, 0xFC))
  charmap.decode(bytes(0xFD))
  charmap.decode("")
end)

h.test("charmap: encode round-trips text it can encode", function()
  local raw = assert(charmap.encode("Hallo, Welt!", "de"))
  h.eq(charmap.decode(raw .. "\255", "de"), "Hallo, Welt!")
  local umlaut = assert(charmap.encode("Größe", "de"))
  h.eq(charmap.decode(umlaut .. "\255", "de"), "Größe")
end)

h.test("charmap: encode reports the first character it can't encode", function()
  local out, bad = charmap.encode("a€b", "en")
  h.eq(out, nil)
  h.eq(bad, "€")
end)

h.test("charmap: flatten joins lines but keeps hyphenated breaks", function()
  h.eq(charmap.flatten("Pokémon-\nCenter"), "Pokémon-Center")
  h.eq(charmap.flatten("Hallo\nWelt\fDu  da"), "Hallo Welt Du da")
  h.eq(charmap.flatten("  \n "), "")
end)

h.test("charmap: pages split on paragraph breaks and drop blanks", function()
  local pages = charmap.pages("eins\ndrei\fzwei\f\f ")
  h.eq(#pages, 2)
  h.eq(pages[1], "eins\ndrei")
  h.eq(pages[2], "zwei")
end)

h.test("charmap: Spanish ¿ ¡ ñ and accents", function()
    local text = charmap.decode(bytes(0x51, 0xCB, 0xE9, 0x1B, 0xFF), "es")
  h.eq(text, "¿Qué")
  h.eq(charmap.decode(bytes(0x52, 0xCD, 0x6F, 0xAB, 0xFF), "es"), "¡Sí!")
  h.eq(charmap.decode(bytes(0xE2, 0xDD, 0x29, 0xE3, 0xFF), "es"), "niño")
end)
