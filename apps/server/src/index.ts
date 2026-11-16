/**
 * Phase 1 server: accept adapter connections over TCP, read newline-delimited
 * JSON messages and print dialogue lines to the terminal.
 *
 * Later phases hang the language pipeline (tokenizer, dictionary, translation,
 * SQLite) and a WebSocket for the UI off handleMessage().
 */
import net from "node:net";
import { styleText } from "node:util";
import { parseAdapterMessage, PROTOCOL_PORT, type AdapterMessage } from "@pokelearning/shared";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? PROTOCOL_PORT);
const MAX_LINE_BYTES = 64 * 1024;

const time = () => new Date().toLocaleTimeString("de-DE", { hour12: false });

function handleMessage(msg: AdapterMessage, client: string): void {
  if (msg.type === "hello") {
    console.log(
      styleText("green", `[${time()}] ${client} says hello:`),
      `${msg.adapter} ${msg.version}, game ${styleText("bold", msg.game)}`,
    );
    return;
  }
  const source = msg.meta?.source ? `/${msg.meta.source}` : "";
  console.log(styleText("dim", `[${time()}] ${msg.game}${source}`));
  console.log("  " + styleText("bold", msg.line));
}

const server = net.createServer((socket) => {
  const client = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(styleText("cyan", `[${time()}] adapter connected (${client})`));
  socket.setEncoding("utf8");

  let buffer = "";
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const raw = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!raw) continue;
      const result = parseAdapterMessage(raw);
      if (result.ok) handleMessage(result.message, client);
      else console.warn(styleText("yellow", `[${time()}] ignored message (${result.error}): ${raw.slice(0, 120)}`));
    }
    if (buffer.length > MAX_LINE_BYTES) {
      console.warn(styleText("yellow", `[${time()}] dropping oversized message from ${client}`));
      buffer = "";
    }
  });
  socket.on("close", () => console.log(styleText("cyan", `[${time()}] adapter disconnected (${client})`)));
  socket.on("error", (err) => console.warn(styleText("yellow", `[${time()}] socket error (${client}): ${err.message}`)));
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Is another server running? Set PORT=… to change it.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(styleText("green", `Pokélearning server listening for adapters on ${HOST}:${PORT}`));
  console.log(styleText("dim", "Load adapters/mgba-lua/main.lua in mGBA (Tools → Scripting…), then talk to someone."));
});
