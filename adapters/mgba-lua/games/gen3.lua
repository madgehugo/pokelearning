-- All Gen 3 Pokémon games: Ruby, Sapphire, FireRed, LeafGreen and Emerald,
-- in every language with the Latin character set.
--
-- The game code at ROM 0x080000AC is three letters for the game plus one for
-- the language, e.g. BPED = Emerald, German; BPRD = FireRed, German. Text
-- buffer addresses are known for the games listed in games/<title>.lua; for
-- the others main.lua finds them by itself (lib/discover.lua) and prints the
-- address, which can then be added to such a file.

local M = {}

M.name = "Pokémon (Gen 3)"

local TITLES = {
  AXV = { id = "ruby",      name = "Pokémon Ruby",      de = "Pokémon Rubin" },
  AXP = { id = "sapphire",  name = "Pokémon Sapphire",  de = "Pokémon Saphir" },
  BPR = { id = "firered",   name = "Pokémon FireRed",   de = "Pokémon Feuerrot" },
  BPG = { id = "leafgreen", name = "Pokémon LeafGreen", de = "Pokémon Blattgrün" },
  BPE = { id = "emerald",   name = "Pokémon Emerald",   de = "Pokémon Smaragd" },
}

-- Last letter of the game code. Japanese uses another character set.
local LANGUAGES = { D = "de", E = "en", F = "fr", I = "it", S = "es" }

-- Known text buffer addresses, per title module.
local KNOWN = {
  emerald = require("games.emerald"),
}

function M.matches(gameCode)
  return TITLES[gameCode:sub(1, 3)] ~= nil and LANGUAGES[gameCode:sub(4, 4)] ~= nil
end

function M.config(gameCode)
  local title = TITLES[gameCode:sub(1, 3)]
  local lang = LANGUAGES[gameCode:sub(4, 4)]
  local known = KNOWN[title.id] and KNOWN[title.id].config(gameCode)
  return {
    game = "pokemon-" .. title.id .. "-" .. lang,
    lang = lang,
    title = lang == "de" and title.de or title.name,
    buffers = known and known.buffers or {},
    cursors = known and known.cursors or {},
    printer = known and known.printer,
    -- no known addresses: find the text buffers while playing
    discover = known == nil,
  }
end

return M
