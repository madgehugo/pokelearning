/**
 * Adapter ingest: accept adapter connections over TCP and parse their
 * newline-delimited JSON messages (docs/adapter-protocol.md).
 */
import net from "node:net";
import { parseAdapterMessage, type AdapterMessage } from "@pokelearning/shared";

const MAX_LINE_BYTES = 64 * 1024;

export interface IngestHandlers {
  onMessage(msg: AdapterMessage, client: string): void;
  onConnect?(client: string): void;
  onDisconnect?(client: string): void;
  onWarning?(text: string): void;
}

export function createIngestServer(handlers: IngestHandlers): net.Server {
  const warn = handlers.onWarning ?? (() => {});
  return net.createServer((socket) => {
    const client = `${socket.remoteAddress}:${socket.remotePort}`;
    handlers.onConnect?.(client);
    socket.setEncoding("utf8");

    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (let newline = buffer.indexOf("\n"); newline !== -1; newline = buffer.indexOf("\n")) {
        const raw = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!raw) continue;
        const result = parseAdapterMessage(raw);
        if (result.ok) handlers.onMessage(result.message, client);
        else warn(`ignored message (${result.error}): ${raw.slice(0, 120)}`);
      }
      if (buffer.length > MAX_LINE_BYTES) {
        warn(`dropping oversized message from ${client}`);
        buffer = "";
      }
    });
    socket.on("close", () => handlers.onDisconnect?.(client));
    socket.on("error", (err) => warn(`socket error (${client}): ${err.message}`));
  });
}
