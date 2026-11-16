/**
 * JSON API for the web UI.
 *
 *   GET    /api/lines?limit=50&before=<id>   history, newest first
 *   GET    /api/status                       ServerStatus
 *   GET    /api/words                        SavedWord[]
 *   POST   /api/words                        SaveWordRequest → SavedWord
 *   DELETE /api/words/:id
 *   GET    /api/review                       ReviewQueue
 *   POST   /api/review/:cardId               AnswerRequest → ReviewQueue
 *   GET    /api/stats                        WordBankStats
 *   GET    /api/settings                     Settings
 *   PUT    /api/settings                     Partial<Settings> → Settings
 *   GET    /api/games                        { availability: GameAvailability[], records: GameRecord[] }
 *   GET    /api/games/:kind                  GameMaterial (a fresh game)
 *   POST   /api/games/results                GameResultRequest → GameResultResponse
 *
 * Writes must be JSON from the page's own origin, so other websites open in
 * the same browser can't change your word bank (the UI may be on the LAN).
 */
import type http from "node:http";
import type { AnswerRequest, GameKind, GameResultRequest, SaveWordRequest, ServerStatus, Settings } from "@pokelearning/shared";
import type { AppDb } from "../db/app-db.ts";
import { GAME_KINDS, GameError, type Games } from "../games/games.ts";
import { WordBankError, type WordBank } from "../wordbank/wordbank.ts";

const MAX_PAGE = 200;
const MAX_BODY = 16 * 1024;

export interface ApiDeps {
  db: AppDb;
  wordbank: WordBank;
  games: Games;
  status: () => ServerStatus;
  /** Called after anything that changes the word bank or the review counts. */
  onWordBankChange: () => void;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

function checkSameOrigin(req: http.IncomingMessage): void {
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, "cross-origin request");
}

async function readJson<T>(req: http.IncomingMessage): Promise<T> {
  checkSameOrigin(req);
  if (!req.headers["content-type"]?.startsWith("application/json")) {
    throw new HttpError(415, "send JSON (content-type: application/json)");
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "request too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

const id = (s: string | undefined) => {
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "invalid id");
  return n;
};

/** Handles /api/*. Returns false for other paths. */
export async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  deps: ApiDeps,
): Promise<boolean> {
  if (!url.pathname.startsWith("/api/")) return false;
  const { db, wordbank } = deps;
  const gameKind = url.pathname.match(/^\/api\/games\/([a-z]+)$/)?.[1];
  const route =
    gameKind && GAME_KINDS.includes(gameKind as GameKind)
      ? `${req.method} /api/games/:kind`
      : `${req.method} ${url.pathname.replace(/\/\d+$/, "/:id")}`;
  const param = url.pathname.match(/\/(\d+)$/)?.[1];

  try {
    switch (route) {
      case "GET /api/lines": {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1), MAX_PAGE);
        const before = url.searchParams.get("before");
        sendJson(res, 200, db.recentLines(limit, before ? Number(before) : undefined));
        break;
      }
      case "GET /api/status":
        sendJson(res, 200, deps.status());
        break;
      case "GET /api/words":
        sendJson(res, 200, wordbank.list());
        break;
      case "POST /api/words": {
        const body = await readJson<SaveWordRequest>(req);
        const word = wordbank.save(body);
        deps.onWordBankChange();
        sendJson(res, 201, word);
        break;
      }
      case "DELETE /api/words/:id":
        checkSameOrigin(req);
        wordbank.remove(id(param));
        deps.onWordBankChange();
        sendJson(res, 204, undefined);
        break;
      case "GET /api/review":
        sendJson(res, 200, wordbank.queue());
        break;
      case "POST /api/review/:id": {
        const body = await readJson<AnswerRequest>(req);
        wordbank.answer(id(param), body.grade, body.durationMs);
        deps.onWordBankChange();
        sendJson(res, 200, wordbank.queue());
        break;
      }
      case "GET /api/stats":
        sendJson(res, 200, wordbank.stats());
        break;
      case "GET /api/settings":
        sendJson(res, 200, wordbank.settings());
        break;
      case "PUT /api/settings": {
        const body = await readJson<Partial<Settings>>(req);
        const settings = wordbank.updateSettings(body);
        deps.onWordBankChange();
        sendJson(res, 200, settings);
        break;
      }
      case "GET /api/games":
        sendJson(res, 200, { availability: deps.games.availability(), records: deps.games.records() });
        break;
      case "GET /api/games/:kind":
        sendJson(res, 200, deps.games.material(gameKind as GameKind));
        break;
      case "POST /api/games/results": {
        const body = await readJson<GameResultRequest>(req);
        sendJson(res, 201, deps.games.saveResult(body));
        break;
      }
      default:
        sendJson(res, 404, { error: "not found" });
    }
  } catch (err) {
    if (err instanceof HttpError || err instanceof WordBankError || err instanceof GameError) {
      sendJson(res, err.status, { error: err.message });
    } else {
      console.error(err);
      sendJson(res, 500, { error: "internal error" });
    }
  }
  return true;
}
