/** Word bank and review: saved words, their FSRS cards, review queue, stats. */
import type { Article } from "./analysis.ts";

/**
 * What a card asks:
 * - meaning: German word → its English meaning
 * - article: noun → der, die or das
 * - recall:  English meaning → the German word (optional, see Settings)
 */
export type CardKind = "meaning" | "article" | "recall";

export type CardState = "new" | "learning" | "review" | "relearning";

/** FSRS grades: 1 again, 2 hard, 3 good, 4 easy. */
export type Grade = 1 | 2 | 3 | 4;

export interface CardSummary {
  id: number;
  kind: CardKind;
  state: CardState;
  /** Unix epoch milliseconds. */
  due: number;
  reps: number;
  lapses: number;
}

/** A sentence from the game the word appeared in. */
export interface WordContext {
  lineId: number;
  text: string;
  translation: string | null;
  /** The word as it appeared, with its offsets in `text`. */
  form: string;
  start: number;
  end: number;
  seenAt: number;
}

export interface SavedWord {
  id: number;
  lemma: string;
  pos: string;
  gender?: string;
  articles?: Article[];
  plural?: string;
  glosses: string[];
  createdAt: number;
  /** Lines in the game that used this word (all sessions, including before saving). */
  encounters: number;
  lastSeenAt: number | null;
  contexts: WordContext[];
  cards: CardSummary[];
}

/** Identifies a word across the app: `${lemma}|${pos}`. */
export const wordKey = (lemma: string, pos: string) => `${lemma}|${pos}`;

export interface ReviewItem {
  card: CardSummary;
  word: SavedWord;
  /** Time until the card comes back for each grade, e.g. { 1: "1 min", 3: "3 days" }. */
  intervals: Record<Grade, string>;
}

export interface ReviewQueue {
  items: ReviewItem[];
  /** Cards due now (not counting new cards). */
  due: number;
  /** New cards still available today. */
  newAvailable: number;
  /** When the next card becomes due, if nothing is due now. */
  nextDue: number | null;
}

export interface WordBankStats {
  words: number;
  /** Cards to review now, including today's new cards. */
  dueNow: number;
  reviewedToday: number;
  /** Share of review-state answers that weren't "again", last 30 days; null without data. */
  retention30d: number | null;
  reviews30d: number;
}

export interface Settings {
  /** New cards introduced per day. */
  newPerDay: number;
  /** Also create English → German cards. */
  recallCards: boolean;
}

/** POST /api/words: save the reading of a word in a stored line. */
export interface SaveWordRequest {
  lineId: number;
  tokenIndex: number;
  /** For compounds: which part. */
  part?: number;
  /** Save this alternative reading instead of the best one. */
  alternative?: number;
}

/** POST /api/review/:cardId */
export interface AnswerRequest {
  grade: Grade;
  durationMs?: number;
}
