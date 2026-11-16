local h = require("harness")
local json = require("lib.json")

h.test("json: scalars", function()
  h.eq(json.encode(nil), "null")
  h.eq(json.encode(true), "true")
  h.eq(json.encode(42), "42")
  h.eq(json.encode(1.5), "1.5")
  h.eq(json.encode(0 / 0), "null")
  h.eq(json.encode(math.huge), "null")
end)

h.test("json: escapes quotes, backslashes and control characters", function()
  h.eq(json.encode('a"b\\c\nd\te'), '"a\\"b\\\\c\\nd\\te"')
  h.eq(json.encode("\1"), '"\\u0001"')
  h.eq(json.encode("Größe „x“"), '"Größe „x“"') -- UTF-8 passes through
end)

h.test("json: arrays and objects (keys sorted)", function()
  h.eq(json.encode({ 1, 2, 3 }), "[1,2,3]")
  h.eq(json.encode({ b = 1, a = { 2 } }), '{"a":[2],"b":1}')
  h.eq(json.encode({}), "{}")
end)

h.test("json: the wire format of a line message", function()
  local msg = json.encode({
    type = "line", adapter = "mgba-gen3", line = "Hallo!\nWelt",
    meta = { source = "menu", address = "0x0800467C" },
  })
  h.eq(msg, '{"adapter":"mgba-gen3","line":"Hallo!\\nWelt","meta":{"address":"0x0800467C","source":"menu"},"type":"line"}')
end)

h.test("json: refuses to encode functions", function()
  local ok = pcall(json.encode, function() end)
  h.eq(ok, false)
end)
