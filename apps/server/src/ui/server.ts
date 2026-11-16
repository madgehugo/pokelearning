/**
 * UI server: serves the built web app (apps/web/dist), the JSON API
 * (./api.ts), and a WebSocket at /ws that pushes every processed line and
 * word-bank change to connected browsers (ServerMessage stream).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { ProcessedLine, ServerMessage, ServerStatus, WordBankSummary } from "@pokelearning/shared";
import type { AppDb } from "../db/app-db.ts";
import type { Games } from "../games/games.ts";
import type { Setup } from "../setup/setup.ts";
import type { WordBank } from "../wordbank/wordbank.ts";
import { handleApi, sendJson } from "./api.ts";

const SNAPSHOT_LINES = 30;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
};

export interface UiServerOptions {
  db: AppDb;
  wordbank: WordBank;
  games: Games;
  setup: Setup;
  status: () => ServerStatus;
  /** Built web app; if missing, "/" explains how to build or run it. */
  staticDir: string;
}

export interface UiServer {
  http: http.Server;
  broadcastLine(line: ProcessedLine): void;
  broadcastStatus(): void;
  broadcastWordBank(): void;
  broadcastSetup(): void;
  close(): void;
}

function serveStatic(staticDir: string, urlPath: string, res: http.ServerResponse): void {
  const root = path.resolve(staticDir);
  const index = path.join(root, "index.html");
  if (!fs.existsSync(index)) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end("The web app isn't built yet. Run `npm run build:web`, or use `npm run dev` for the live dev server.\n");
    return;
  }
  const requested = path.resolve(root, `.${decodeURIComponent(urlPath)}`);
  const inside = requested === root || requested.startsWith(root + path.sep);
  const file = inside && fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : index;
  const ext = path.extname(file);
  res.writeHead(200, {
    "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
    // Vite puts a content hash in asset names, so those can be cached forever.
    "cache-control": file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
  });
  fs.createReadStream(file).pipe(res);
}

export function createUiServer({ db, wordbank, games, setup, status, staticDir }: UiServerOptions): UiServer {
  const summary = (): WordBankSummary => ({ saved: wordbank.savedKeys(), stats: wordbank.stats() });
  const apiDeps = { db, wordbank, games, setup, status, onWordBankChange: () => broadcast({ type: "wordbank", wordbank: summary() }) };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    handleApi(req, res, url, apiDeps).then((handled) => {
      if (handled) return;
      if (req.method !== "GET" && req.method !== "HEAD") sendJson(res, 405, { error: "method not allowed" });
      else serveStatic(staticDir, url.pathname, res);
    });
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  const send = (ws: WebSocket, msg: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const broadcast = (msg: ServerMessage) => {
    const data = JSON.stringify(msg);
    for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.send(data);
  };

  wss.on("connection", (ws) => {
    send(ws, { type: "snapshot", lines: db.recentLines(SNAPSHOT_LINES), status: status(), wordbank: summary() });
  });

  // Drop browsers that vanished without closing (phone locked, Wi-Fi lost).
  const alive = new WeakSet<WebSocket>();
  wss.on("connection", (ws) => {
    alive.add(ws);
    ws.on("pong", () => alive.add(ws));
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, 30_000);

  return {
    http: server,
    broadcastLine: (line) => broadcast({ type: "line", line }),
    broadcastStatus: () => broadcast({ type: "status", status: status() }),
    broadcastWordBank: apiDeps.onWordBankChange,
    broadcastSetup: () => broadcast({ type: "setup", setup: setup.status() }),
    close: () => {
      clearInterval(heartbeat);
      wss.close();
      server.close();
    },
  };
}
