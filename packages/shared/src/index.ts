/**
 * Adapter protocol: what every game adapter (mGBA Lua script, OCR, …) sends
 * to the server. Transport is newline-delimited JSON, one message per line.
 * See docs/adapter-protocol.md.
 */

export const PROTOCOL_PORT = 8765;

/** Sent once after an adapter connects. */
export interface HelloMessage {
  type: "hello";
  /** Adapter implementation, e.g. "mgba-gen3", "ocr". */
  adapter: string;
  version: string;
  /** Game id, e.g. "pokemon-emerald-de". */
  game: string;
  timestamp: number;
}

/** One piece of dialogue as it appeared in the game. */
export interface LineMessage {
  type: "line";
  adapter: string;
  game: string;
  /** BCP-47-ish language of the text, e.g. "de". */
  lang?: string;
  /** The full text, line breaks flattened to spaces. */
  line: string;
  /** Unix epoch milliseconds (0 if the adapter has no clock). */
  timestamp: number;
  /** Adapter-specific extras (source buffer, page layout, …). */
  meta?: LineMeta;
}

export interface LineMeta {
  /** Which buffer or region the text came from, e.g. "field", "battle". */
  source?: string;
  /** The text split into text-box pages, each with "\n" line breaks. */
  pages?: string[];
  /** The adapter already sent this text in this session (e.g. the same NPC again). */
  repeated?: boolean;
  [key: string]: unknown;
}

export type AdapterMessage = HelloMessage | LineMessage;

export type ParseResult =
  | { ok: true; message: AdapterMessage }
  | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Parse and validate one JSON line from an adapter. */
export function parseAdapterMessage(raw: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: "invalid JSON" };
  }
  if (!isObject(data)) return { ok: false, error: "message is not an object" };

  const str = (key: string) => typeof data[key] === "string";
  if (!str("adapter") || !str("game")) {
    return { ok: false, error: "missing adapter or game" };
  }
  const timestamp = typeof data.timestamp === "number" ? data.timestamp : 0;

  switch (data.type) {
    case "hello":
      return {
        ok: true,
        message: {
          type: "hello",
          adapter: data.adapter as string,
          version: str("version") ? (data.version as string) : "unknown",
          game: data.game as string,
          timestamp,
        },
      };
    case "line":
      if (!str("line")) return { ok: false, error: "line message without text" };
      return {
        ok: true,
        message: {
          type: "line",
          adapter: data.adapter as string,
          game: data.game as string,
          ...(str("lang") ? { lang: data.lang as string } : {}),
          line: data.line as string,
          timestamp,
          ...(isObject(data.meta) ? { meta: data.meta as LineMeta } : {}),
        },
      };
    default:
      return { ok: false, error: `unknown message type ${JSON.stringify(data.type)}` };
  }
}

export * from "./analysis.ts";
export * from "./ui.ts";
