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
  [key: string]: unknown;
}

export type AdapterMessage = HelloMessage | LineMessage;

/**
 * Oldest version of each adapter this server works properly with. Raise an entry when
 * the server starts relying on something an older adapter doesn't send. Adapters not
 * listed here (third-party ones) aren't checked.
 */
export const MIN_ADAPTER_VERSION: Record<string, string> = {
  "mgba-gen3": "0.1.0",
};

/** Compare "major.minor.patch" strings. Negative if a < b; NaN if either isn't a version. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split(".").map(Number) : null);
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return NaN;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  return 0;
}

/** A sentence for the user if this adapter is too old (or doesn't say its version), else null. */
export function adapterVersionProblem(hello: Pick<HelloMessage, "adapter" | "version">): string | null {
  const min = MIN_ADAPTER_VERSION[hello.adapter];
  if (!min) return null;
  const cmp = compareVersions(hello.version, min);
  if (cmp >= 0) return null;
  const found = Number.isNaN(cmp) ? "an unknown version" : `version ${hello.version}`;
  return `The script loaded in mGBA is ${found}; this app needs ${min} or newer. Reload main.lua from the app's folder (Tools → Scripting → File → Load script).`;
}

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
export * from "./wordbank.ts";
export * from "./games.ts";
export * from "./text.ts";
export * from "./setup.ts";
