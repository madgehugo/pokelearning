-- Runs every test/*_test.lua. Exit code is non-zero if any test fails.
local dir = (arg[0]:match("^(.*)[/\\][^/\\]*$")) or "."
package.path = dir .. "/../?.lua;" .. dir .. "/?.lua;" .. package.path

local h = require("harness")
local files = { "charmap", "json", "textmem", "discover", "games", "menu" }
for _, name in ipairs(files) do
  dofile(dir .. "/" .. name .. "_test.lua")
end

for _, f in ipairs(h.failures) do io.stderr:write("FAIL ", f, "\n\n") end
print(string.format("%d passed, %d failed", h.passed, h.failed))
os.exit(h.failed == 0 and 0 or 1)
