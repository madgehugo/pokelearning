local h = require("harness")
local charmap = require("lib.charmap")
local Discovery = require("lib.discover")
local textmem = require("lib.textmem")

local EW = textmem.EWRAM.start
local function enc(s) return assert(charmap.encode(s, "de")) .. "\xFF" end

local function showMessage(e, addr, text)
  e.poke(addr, string.rep("\0", 64)) -- clear the line so shorter texts leave no tail
  e.poke(addr, enc(text))
end

h.test("discover: adopts a buffer after three different sentences", function()
  local e = h.fakeEmu()
  emu = e
  local d = Discovery.new("de")
  local addr = EW + 0x2000
  h.eq(d:step(), nil) -- first look only takes a snapshot
  local msgs = { "Hallo, wie geht es dir heute?", "Das Wetter ist sehr schoen hier.", "Ich suche mein Pokemon überall." }
  local adopted
  for _, m in ipairs(msgs) do
    showMessage(e, addr, m)
    adopted = d:step() or adopted
  end
  h.truthy(adopted, "a buffer should have been adopted")
  h.eq(adopted.addr, addr)
  h.eq(#d.adopted, 1)
end)

h.test("discover: one repeated message is not enough", function()
  local e = h.fakeEmu()
  emu = e
  local d = Discovery.new("de")
  local addr = EW + 0x2000
  d:step()
  showMessage(e, addr, "Hallo, wie geht es dir heute?")
  h.eq(d:step(), nil)
  showMessage(e, addr, "Hallo, wie geht es dir heute?")
  h.eq(d:step(), nil)
  h.eq(#d.adopted, 0)
end)

h.test("discover: non-sentence data (too short, no spaces) is ignored", function()
  local e = h.fakeEmu()
  emu = e
  local d = Discovery.new("de")
  local addr = EW + 0x3000
  d:step()
  for _, m in ipairs({ "Abcdefghijklmnop", "Hi du", "Zzzzzzzzzzzzzzzzzzzz", "Ok ok ok" }) do
    showMessage(e, addr, m)
    h.eq(d:step(), nil)
  end
  h.eq(#d.adopted, 0)
end)

h.test("discover: stops looking once four buffers are adopted", function()
  local e = h.fakeEmu()
  emu = e
  local d = Discovery.new("de")
  d:step()
  for i = 0, 3 do
    local addr = EW + 0x4000 + i * 0x2000
    for _, m in ipairs({ "Hallo, wie geht es dir heute?", "Das Wetter ist sehr schoen hier.", "Ich suche mein Pokemon überall." }) do
      showMessage(e, addr, m)
      d:step()
    end
  end
  h.eq(#d.adopted, 4)
  h.truthy(d:done())
  h.eq(d:step(), nil)
end)

h.test("discover: adopted buffer size is capped by the next known buffer", function()
  local d = Discovery.new("de")
  d.adopted[1] = { addr = EW + 0x500, size = 100 }
  local buf = d:adopt(EW + 0x300)
  h.eq(buf.size, 0x200)
end)

h.test("discover: insideAdopted", function()
  local d = Discovery.new("de")
  d.adopted[1] = { addr = EW + 0x100, size = 0x100 }
  h.truthy(d:insideAdopted(EW + 0x100))
  h.truthy(d:insideAdopted(EW + 0x1FF))
  h.truthy(not d:insideAdopted(EW + 0x200))
  h.truthy(not d:insideAdopted(EW + 0xFF))
end)

h.test("discover: summary lists candidates by messages seen", function()
  local d = Discovery.new("de")
  d.candidates[EW + 1] = { seen = {}, distinct = 1 }
  d.candidates[EW + 2] = { seen = {}, distinct = 2 }
  local s = d:summary()
  h.eq(s[1].addr, EW + 2)
  h.eq(s[2].addr, EW + 1)
end)
