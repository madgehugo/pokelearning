-- TCP transport to the companion server: newline-delimited JSON.
-- Uses mGBA's built-in `socket` API (mGBA 0.10+). Reconnects automatically and
-- keeps a small queue so lines seen while the server is down are not lost.

local json = require("lib.json")

local M = {}
M.__index = M

local MAX_QUEUE = 50

function M.new(opts)
  local self = setmetatable({}, M)
  self.host = opts.host or "127.0.0.1"
  self.port = opts.port or 8765
  self.retryFrames = opts.retryFrames or 120 -- ~2 s at 60 fps
  self.onConnect = opts.onConnect           -- called with self after each (re)connect
  self.log = opts.log or print
  self.sock = nil
  self.queue = {}
  self.cooldown = 0
  self.warned = false
  return self
end

function M:connected()
  return self.sock ~= nil
end

function M:disconnect(reason)
  if self.sock then
    self.log("[transport] disconnected" .. (reason and (": " .. tostring(reason)) or ""))
    pcall(function() self.sock:close() end)
  end
  self.sock = nil
  self.cooldown = self.retryFrames
end

function M:tryConnect()
  local ok, sock, err = pcall(socket.connect, self.host, self.port)
  if ok and sock then
    self.sock = sock
    self.warned = false
    sock:add("error", function() self:disconnect("socket error") end)
    self.log(string.format("[transport] connected to %s:%d", self.host, self.port))
    if self.onConnect then self.onConnect(self) end
    self:flush()
    return true
  end
  if not self.warned then
    self.log(string.format("[transport] server not reachable at %s:%d (%s), retrying…",
      self.host, self.port, tostring(ok and err or sock)))
    self.warned = true
  end
  self.cooldown = self.retryFrames
  return false
end

-- Call once per frame.
function M:tick()
  if self.sock then
    pcall(function() self.sock:poll() end)
    return
  end
  if self.cooldown > 0 then
    self.cooldown = self.cooldown - 1
  else
    self:tryConnect()
  end
end

function M:rawSend(payload)
  local ok, sent, err = pcall(function() return self.sock:send(payload) end)
  if not ok or sent == nil then
    self:disconnect(ok and err or sent)
    return false
  end
  return true
end

function M:flush()
  while self.sock and #self.queue > 0 do
    if not self:rawSend(self.queue[1]) then return end
    table.remove(self.queue, 1)
  end
end

-- Send a Lua table as one JSON line. Queued if not connected.
function M:send(message, queueIfOffline)
  local payload = json.encode(message) .. "\n"
  if self.sock and #self.queue == 0 and self:rawSend(payload) then return end
  if queueIfOffline ~= false then
    self.queue[#self.queue + 1] = payload
    if #self.queue > MAX_QUEUE then table.remove(self.queue, 1) end
  end
end

-- Put a message at the front of the queue (used for the handshake in onConnect,
-- which runs before queued lines are flushed).
function M:sendFirst(message)
  table.insert(self.queue, 1, json.encode(message) .. "\n")
end

return M
