/**
 * Server ↔ browser UI protocol: JSON messages over a WebSocket at /ws.
 * The server sends a snapshot on connect, then one message per event.
 */
import type { ProcessedLine } from "./analysis.ts";
import type { SetupStatus } from "./setup.ts";
import type { HiddenWord, WordBankStats } from "./wordbank.ts";

export const UI_PORT = 8766;

export interface ServerStatus {
  /** Game adapters currently connected. */
  adapters: number;
  /** Game id from the most recent adapter hello. */
  game: string | null;
  /** Translation provider id, or null if translation is off or failed to load. */
  translator: string | null;
  /** Dictionary build, or null if none is installed. */
  dictionary: string | null;
}

/** Which words are saved (as wordKey strings) and the review counts. */
export interface WordBankSummary {
  saved: string[];
  /** Words hidden from the breakdown. */
  hidden: HiddenWord[];
  stats: WordBankStats;
}

export type ServerMessage =
  /** Sent on connect: recent lines, newest first. */
  | { type: "snapshot"; lines: ProcessedLine[]; status: ServerStatus; wordbank: WordBankSummary }
  | { type: "line"; line: ProcessedLine }
  | { type: "status"; status: ServerStatus }
  /** After a word is saved or removed, a card is answered, or settings change. */
  | { type: "wordbank"; wordbank: WordBankSummary }
  /** First-launch setup progress (dictionary, names, translation model). */
  | { type: "setup"; setup: SetupStatus };
