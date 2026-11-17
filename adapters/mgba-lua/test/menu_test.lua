local h = require("harness")
local charmap = require("lib.charmap")
local Menu = require("lib.menu")

local TEMPLATE = 0x02000100 -- RAM address of a fake text printer template
local ROM_STR  = 0x08100000
local RAM_STR  = 0x02001000

local function enc(s) return assert(charmap.encode(s, "de")) .. "\xFF" end

-- Fake emulator that can also report registers, like mGBA's breakpoint callbacks.
local function setup()
  local e = h.fakeEmu()
  e.regs = {}
  function e:readRegister(r) return self.regs[r] end
  function e:read32(addr)
    return self:read8(addr) | self:read8(addr + 1) << 8 | self:read8(addr + 2) << 16 | self:read8(addr + 3) << 24
  end
  emu = e
  return e
end

-- Simulate the game calling AddTextPrinter(template -> ptr, speed).
local function draw(e, menu, frame, ptr, speed, template)
  template = template or TEMPLATE
  e.poke(template, string.pack("<I4", ptr))
  e.regs.r0, e.regs.r1 = template, speed
  menu:onPrint(frame)
end

h.test("menu: collects ROM strings and flushes them once drawing stops", function()
  local e = setup()
  e.poke(ROM_STR, enc("Neues Spiel"))
  e.poke(ROM_STR + 0x20, enc("Einstellungen"))
  local menu = Menu.new("de")
  draw(e, menu, 100, ROM_STR, 0xFF)
  draw(e, menu, 101, ROM_STR + 0x20, 0xFF)
  h.eq(menu:flush(102), nil, "still drawing")
  local text, address = menu:flush(101 + Menu.QUIET_FRAMES)
  h.eq(text, "Neues Spiel\nEinstellungen")
  h.eq(address, ROM_STR)
  h.eq(menu:flush(500), nil, "nothing left to send")
end)

h.test("menu: a label drawn well before the rest of the screen still belongs to it", function()
  -- the bag draws its pocket name about 18 frames before the item list
  local e = setup()
  e.poke(ROM_STR, enc("OBJETOS"))
  e.poke(ROM_STR + 0x20, enc("Volver al juego"))
  local menu = Menu.new("de")
  draw(e, menu, 100, ROM_STR, 0xFF)
  draw(e, menu, 118, ROM_STR + 0x20, 0xFF)
  h.eq(menu:flush(118), nil)
  h.eq(menu:flush(117), nil, "not flushed between the two")
  h.eq((menu:flush(118 + Menu.QUIET_FRAMES)), "OBJETOS\nVolver al juego")
end)

-- The bag's pocket names: drawn into a double-width window, a pair at a time (x < 64 and x >= 64),
-- in their own colours (template bytes 12-13).
local function pocketName(e, menu, frame, ptr, x)
  e.poke(TEMPLATE + 4, "\x06\x01" .. string.char(x, 1, x, 1) .. "\0\0\x10\x40")
  draw(e, menu, frame, ptr, 0xFF)
end

h.test("menu: of the bag's two pocket names only the one on screen is sent", function()
  local e = setup()
  local OBJ, BALLS, TM = ROM_STR, ROM_STR + 0x20, ROM_STR + 0x40
  e.poke(OBJ, enc("OBJETOS")); e.poke(BALLS, enc("POKé BALLS")); e.poke(TM, enc("MT / MO"))
  local menu = Menu.new("de")
  local function screen(frame, first, second, fx, sx)
    pocketName(e, menu, frame, first, fx)
    if second then pocketName(e, menu, frame, second, sx) end
    return (menu:flush(frame + Menu.QUIET_FRAMES))
  end
  h.eq(screen(100, OBJ, nil, 11), "OBJETOS", "the bag opens on its first pocket")
  h.eq(screen(200, OBJ, BALLS, 11, 67), "POKé BALLS", "scrolling right: the second is the new one")
  h.eq(screen(300, BALLS, TM, 3, 78), "MT / MO", "and again")
  h.eq(screen(400, BALLS, TM, 3, 78), "POKé BALLS", "scrolling back left: the first is the new one")
  h.eq(screen(500, OBJ, BALLS, 11, 67), "OBJETOS", "and again")
end)

h.test("menu: other labels in two columns are both kept", function()
  local e = setup()
  e.poke(ROM_STR, enc("TEXTO")); e.poke(ROM_STR + 0x20, enc("LENTO"))
  local menu = Menu.new("de")
  e.poke(TEMPLATE + 4, "\x01\x01\x08\x01\x08\x01\0\0\x10\x30"); draw(e, menu, 100, ROM_STR, 0xFF)
  e.poke(TEMPLATE + 4, "\x01\x01\x68\x01\x68\x01\0\0\x10\x30"); draw(e, menu, 100, ROM_STR + 0x20, 0xFF)
  h.eq((menu:flush(100 + Menu.QUIET_FRAMES)), "TEXTO\nLENTO")
end)

h.test("menu: the same screen redrawn is only sent once", function()
  local e = setup()
  e.poke(ROM_STR, enc("Neues Spiel"))
  local menu = Menu.new("de")
  draw(e, menu, 10, ROM_STR, 0)
  h.eq(menu:flush(10 + Menu.QUIET_FRAMES), "Neues Spiel", ROM_STR)
  draw(e, menu, 100, ROM_STR, 0)
  h.eq(menu:flush(100 + Menu.QUIET_FRAMES), nil)
  -- a different screen goes through, and the first one can come back after it
  e.poke(ROM_STR + 0x20, enc("Fortsetzen"))
  draw(e, menu, 200, ROM_STR + 0x20, 0)
  h.eq(menu:flush(200 + Menu.QUIET_FRAMES), "Fortsetzen")
  draw(e, menu, 300, ROM_STR, 0)
  h.eq(menu:flush(300 + Menu.QUIET_FRAMES), "Neues Spiel")
end)

h.test("menu: a string drawn twice in one screen is listed once", function()
  local e = setup()
  e.poke(ROM_STR, enc("Beenden"))
  local menu = Menu.new("de")
  draw(e, menu, 1, ROM_STR, 0)
  draw(e, menu, 2, ROM_STR, 0)
  h.eq(menu:flush(2 + Menu.QUIET_FRAMES), "Beenden")
end)

h.test("menu: RAM strings count only when drawn instantly (labels), not typed dialogue", function()
  local e = setup()
  e.poke(RAM_STR, enc("SPIELER"))
  local menu = Menu.new("de")
  draw(e, menu, 1, RAM_STR, 1) -- letter by letter: dialogue, read from its buffer instead
  h.eq(menu:flush(1 + Menu.QUIET_FRAMES), nil)
  draw(e, menu, 5, RAM_STR, 0xFF)
  h.eq(menu:flush(5 + Menu.QUIET_FRAMES), "SPIELER")
end)

h.test("menu: ROM strings count at any speed", function()
  local e = setup()
  e.poke(ROM_STR, enc("Pokémon-Center"))
  local menu = Menu.new("de")
  draw(e, menu, 1, ROM_STR, 2)
  h.eq(menu:flush(1 + Menu.QUIET_FRAMES), "Pokémon-Center")
end)

h.test("menu: ignores a template that isn't in RAM and pointers to nowhere", function()
  local e = setup()
  e.poke(ROM_STR, enc("Neues Spiel"))
  local menu = Menu.new("de")
  draw(e, menu, 1, ROM_STR, 0, 0x08200000) -- template in ROM
  draw(e, menu, 2, 0x04000000, 0)          -- pointer into I/O
  h.eq(menu:flush(2 + Menu.QUIET_FRAMES), nil)
end)

h.test("menu: ignores strings that don't look like text", function()
  local e = setup()
  e.poke(ROM_STR, "\xBB\xFF")             -- one letter
  e.poke(ROM_STR + 0x20, "\x0A\x0A\x0A\x0A\xFF") -- unmapped bytes
  local menu = Menu.new("de")
  draw(e, menu, 1, ROM_STR, 0)
  draw(e, menu, 2, ROM_STR + 0x20, 0)
  h.eq(menu:flush(2 + Menu.QUIET_FRAMES), nil)
end)

h.test("menu: stops collecting after MAX_ITEMS", function()
  local e = setup()
  local menu = Menu.new("de")
  for i = 1, Menu.MAX_ITEMS + 5 do
    local addr = ROM_STR + i * 0x40
    e.poke(addr, enc("Eintrag " .. string.char(64 + (i % 26) + 1) .. string.char(97 + i % 26)))
    draw(e, menu, i, addr, 0)
  end
  h.eq(#menu.items, Menu.MAX_ITEMS)
end)

h.test("menu: flush doesn't fire before the quiet period, even with items waiting", function()
  local e = setup()
  e.poke(ROM_STR, enc("Neues Spiel"))
  local menu = Menu.new("de")
  draw(e, menu, 100, ROM_STR, 0)
  h.eq(menu:flush(100 + Menu.QUIET_FRAMES - 1), nil)
  h.eq(menu:flush(100 + Menu.QUIET_FRAMES), "Neues Spiel")
end)

-- AddTextPrinter lookup
local HEAD = "\xF0\xB5\x06\x1C\x94\x46\x09\x06\x0D\x0E"
local function printerCode(offsetByte) return HEAD .. string.char(offsetByte) .. "\x48\x00\x68\x00\x28\x04\xD1" end
local BASE = 0x08000000

h.test("menu: locates AddTextPrinter by its code, wherever the build put it", function()
  local e = setup()
  e.poke(BASE + 0x1234, printerCode(0x03))
  h.eq(Menu.locatePrinter(nil, BASE, 0x4000), BASE + 0x1234)
  h.eq(Menu.locatePrinter({ addr = BASE + 0x9999, bytes = "\1\2" }, BASE, 0x4000), BASE + 0x1234, "pinned address is wrong")
end)

h.test("menu: a pinned address is used when its bytes match", function()
  local e = setup()
  e.poke(BASE + 0x100, "\xAA\xBB")
  h.eq(Menu.locatePrinter({ addr = BASE + 0x100, bytes = "\xAA\xBB" }, BASE, 0x4000), BASE + 0x100)
end)

h.test("menu: finds a match that straddles a scan chunk", function()
  local e = setup()
  local at = BASE + 0x10000 - 5 -- chunks are 0x10000 bytes
  e.poke(at, printerCode(0x0A))
  h.eq(Menu.locatePrinter(nil, BASE, 0x20000), at)
end)

h.test("menu: no match, or more than one, means no printer", function()
  local e = setup()
  local addr, why = Menu.locatePrinter(nil, BASE, 0x4000)
  h.eq(addr, nil)
  h.eq(why, "not found")
  e.poke(BASE + 0x10, printerCode(0x03))
  e.poke(BASE + 0x400, printerCode(0x03))
  addr, why = Menu.locatePrinter(nil, BASE, 0x4000)
  h.eq(addr, nil)
  h.eq(why, "found more than once")
end)

h.test("menu: the first bytes alone aren't enough", function()
  local e = setup()
  e.poke(BASE + 0x10, HEAD .. "\x03\x49\x00\x68\x00\x28") -- ldr into r1: a different function
  h.eq(Menu.locatePrinter(nil, BASE, 0x4000), nil)
end)
