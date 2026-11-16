local h = require("harness")
local textmem = require("lib.textmem")

local EW = textmem.EWRAM.start

h.test("textmem: region predicates", function()
  h.truthy(textmem.isRom(0x08000000))
  h.truthy(not textmem.isRom(0x07FFFFFF))
  h.truthy(not textmem.isRom(0x0A000000))
  h.truthy(textmem.isRam(EW))
  h.truthy(textmem.isRam(0x03000000))
  h.truthy(not textmem.isRam(EW + 0x40000))
  h.truthy(not textmem.isRam(0x08000000))
end)

h.test("textmem: readString stops at the terminator", function()
  emu = h.fakeEmu({ [EW] = "\xBB\xBC\xFF\xBD" })
  h.eq(textmem.readString(EW), "\xBB\xBC")
end)

h.test("textmem: readString without a terminator returns everything read", function()
  emu = h.fakeEmu({ [EW] = "\xBB\xBC" })
  h.eq(textmem.readString(EW, 2), "\xBB\xBC")
end)

h.test("textmem: stringStart finds the byte after the previous terminator", function()
  emu = h.fakeEmu({ [EW] = "\xBB\xFF\xBC\xBD\xBE\xBF" })
  local start, found = textmem.stringStart(EW + 4, 16)
  h.eq(start, EW + 2)
  h.eq(found, true)
end)

h.test("textmem: stringStart stops at a run of identical padding bytes", function()
  emu = h.fakeEmu({ [EW] = "\x00\x00\x00\x00\xBC\xBD\xBE" })
  local start, found = textmem.stringStart(EW + 6, 16)
  h.eq(start, EW + 4)
  h.eq(found, true)
end)

h.test("textmem: stringStart reports when no boundary was seen", function()
  emu = h.fakeEmu({ [EW + 100] = "\xBB\xBC\xBD\xBE\xBF" })
  local start, found = textmem.stringStart(EW + 104, 4)
  h.eq(start, EW + 100)
  h.eq(found, false)
end)

h.test("textmem: printerStringStart treats a cursor past the terminator as 'just ended'", function()
  emu = h.fakeEmu({ [EW] = "\xFF\xBB\xBC\xBD\xFF" })
  -- cursor one past the final FF: the string is the one that ended there
  h.eq(textmem.printerStringStart(EW + 5, 16), EW + 1)
  -- cursor in the middle of it
  h.eq(textmem.printerStringStart(EW + 3, 16), EW + 1)
end)
