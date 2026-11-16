-- Minimal JSON encoder: strings, numbers, booleans, nil, arrays and objects.
-- Strings are assumed to already be UTF-8.

local M = {}

local escapes = {
  ['"'] = '\\"', ["\\"] = "\\\\", ["\b"] = "\\b", ["\f"] = "\\f",
  ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t",
}

local function encodeString(s)
  return '"' .. s:gsub('[%c"\\]', function(c)
    return escapes[c] or string.format("\\u%04x", c:byte())
  end) .. '"'
end

local function isArray(t)
  local n = 0
  for _ in pairs(t) do n = n + 1 end
  return n == #t
end

local encode
function encode(v)
  local kind = type(v)
  if kind == "nil" then
    return "null"
  elseif kind == "boolean" then
    return tostring(v)
  elseif kind == "number" then
    if v ~= v or v == math.huge or v == -math.huge then return "null" end
    if math.type(v) == "integer" then return tostring(v) end
    return string.format("%.14g", v)
  elseif kind == "string" then
    return encodeString(v)
  elseif kind == "table" then
    local parts = {}
    if next(v) ~= nil and isArray(v) then
      for i = 1, #v do parts[i] = encode(v[i]) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    local keys = {}
    for k in pairs(v) do keys[#keys + 1] = k end
    table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
    for _, k in ipairs(keys) do
      parts[#parts + 1] = encodeString(tostring(k)) .. ":" .. encode(v[k])
    end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  error("json: cannot encode " .. kind)
end

M.encode = encode
return M
