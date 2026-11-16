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
