-- Tiny test runner: no dependencies, runs under plain Lua 5.4+.
-- Usage: lua test/run.lua   (from adapters/mgba-lua)

local M = { passed = 0, failed = 0, failures = {} }

function M.test(name, fn)
  local ok, err = xpcall(fn, debug.traceback)
  if ok then
    M.passed = M.passed + 1
  else
    M.failed = M.failed + 1
    M.failures[#M.failures + 1] = name .. "\n" .. tostring(err)
  end
end

function M.eq(actual, expected, label)
  if actual ~= expected then
    error(string.format("%sexpected %q, got %q", label and (label .. ": ") or "",
      tostring(expected), tostring(actual)), 2)
  end
end

function M.truthy(v, label) if not v then error((label or "expected a truthy value"), 2) end end

-- Fake `emu` backed by a sparse byte map, like mGBA's scripting API.
-- Use M.fakeEmu({ [addr] = "bytes" }) and assign the result to the global `emu`.
function M.fakeEmu(regions)
  local mem = {}
  local fake = {}
  function fake.poke(addr, bytes)
    for i = 1, #bytes do mem[addr + i - 1] = bytes:byte(i) end
  end
  for addr, bytes in pairs(regions or {}) do fake.poke(addr, bytes) end
  function fake:read8(addr) return mem[addr] or 0 end
  function fake:readRange(addr, len)
    local out = {}
    for i = 0, len - 1 do out[#out + 1] = string.char(mem[addr + i] or 0) end
    return table.concat(out)
  end
  return fake
end

return M
