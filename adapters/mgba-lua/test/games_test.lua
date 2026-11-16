local h = require("harness")
local gen3 = require("games.gen3")
local emerald = require("games.emerald")

h.test("games: gen3 recognises every title in every Latin language", function()
  for _, title in ipairs({ "AXV", "AXP", "BPR", "BPG", "BPE" }) do
    for _, lang in ipairs({ "D", "E", "F", "I", "S" }) do
      h.truthy(gen3.matches(title .. lang), title .. lang)
    end
  end
end)

h.test("games: gen3 rejects Japanese, unknown titles and junk", function()
  h.eq(gen3.matches("BPEJ"), false)
  h.eq(gen3.matches("XXXE"), false)
  h.eq(gen3.matches(""), false)
end)

h.test("games: Smaragd (BPED) has pinned buffers and a menu printer", function()
  local c = gen3.config("BPED")
  h.eq(c.game, "pokemon-emerald-de")
  h.eq(c.lang, "de")
  h.eq(c.title, "Pokémon Smaragd")
  h.eq(c.discover, false)
  h.eq(#c.buffers, 2)
  h.truthy(c.printer and #c.printer.bytes > 0, "printer")
end)

h.test("games: games with no known addresses fall back to discovery", function()
  local c = gen3.config("BPRD") -- FireRed, German
  h.eq(c.discover, true)
  h.eq(c.game, "pokemon-firered-de")
  h.eq(c.title, "Pokémon Feuerrot")
  h.eq(#c.buffers, 0)
  h.eq(c.printer, nil)
end)

h.test("games: an Emerald region with no entry (e.g. French) falls back to discovery", function()
  local c = gen3.config("BPEF")
  h.eq(c.discover, true)
  h.eq(c.lang, "fr")
end)

h.test("games: every pinned Emerald buffer is well formed and in EWRAM", function()
  for code, v in pairs(emerald.versions) do
    for _, b in ipairs(v.buffers) do
      h.truthy(b.addr >= 0x02000000 and b.addr + b.size <= 0x02040000, code .. " " .. b.name)
    end
    if v.printer then
      h.truthy(v.printer.addr >= 0x08000000 and v.printer.addr < 0x0A000000, code .. " printer in ROM")
    end
  end
end)
