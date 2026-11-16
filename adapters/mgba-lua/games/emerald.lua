-- Pokémon Emerald / Smaragd game module.
--
-- Dialogue detection: in pokeemerald, field messages (NPCs, signs, script
-- msgboxes) are expanded into gStringVar4 by ShowFieldMessage() before they are
-- printed, and battle messages are expanded into gDisplayedStringBattle.
-- We watch those buffers and emit their contents once they change and settle.
--
-- Addresses come from pokeemerald.sym (US release, game code BPEE). The other
-- releases were built from slightly different code, so their RAM layout can
-- shift. Use tools/find_text.lua to find or confirm the addresses for your ROM
-- (see docs/finding-addresses.md) and fill them in below.

local M = {}

M.name = "Pokémon Emerald"

-- Keyed by the 4-letter game code at ROM 0x080000AC.
-- `verified = false` means the address is a guess: main.lua warns about it.
M.versions = {
  BPEE = {
    game = "pokemon-emerald-en",
    lang = "en",
    buffers = {
      { name = "field",  addr = 0x02021FC4, size = 1000, verified = true }, -- gStringVar4
      { name = "battle", addr = 0x02022E2C, size = 300,  verified = true }, -- gDisplayedStringBattle
    },
  },
  BPED = {
    game = "pokemon-emerald-de",
    lang = "de",
    buffers = {
      -- both confirmed in-game: same addresses as the US release
      { name = "field",  addr = 0x02021FC4, size = 1000, verified = true },
      { name = "battle", addr = 0x02022E2C, size = 300,  verified = true },
    },
  },
}

function M.matches(gameCode)
  return M.versions[gameCode] ~= nil
end

function M.config(gameCode)
  return M.versions[gameCode]
end

return M
