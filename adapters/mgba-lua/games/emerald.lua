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
-- A buffer may also set `cursor` (RAM address of the text printer's pointer
-- into it); otherwise main.lua discovers it after a few messages.
-- `cursors` lists text printed straight from ROM, e.g.
--   cursors = { { name = "bag", addr = 0x0300xxxx } }
-- (find addresses with tools/find_text.lua: docs/finding-addresses.md).
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
    cursors = {},
    -- AddTextPrinter (r0 = template, whose first word is the string pointer): everything the
    -- game draws goes through it, menus included. Found by disassembling the ROM; `bytes`
    -- is its first instructions, checked before hooking. Games without an entry
    -- (other languages, other titles) have it found by its code: see lib/menu.lua.
    printer = { addr = 0x0800467C, bytes = "\xF0\xB5\x06\x1C\x94\x46" },
  },
}

function M.matches(gameCode)
  return M.versions[gameCode] ~= nil
end

function M.config(gameCode)
  return M.versions[gameCode]
end

return M
