/** Mini-games built from your own game lines and word bank. */
import type { Article } from "./analysis.ts";

export type GameKind = "articles" | "cloze" | "listening" | "matching";

/** Where a word or line came from: highlighted with `start`/`end` in `text`. */
export interface GameExample {
  text: string;
  translation: string | null;
  start: number;
  end: number;
}

/** Article sprint: one noun. */
export interface ArticleItem {
  lemma: string;
  article: Article;
  plural?: string;
  gloss: string;
  saved: boolean;
  example?: GameExample;
}

/** Fill the gap: a line with one word to choose. */
export interface ClozeRound {
  lineId: number;
  text: string;
  translation: string | null;
  /** The blanked word's offsets in `text`. */
  start: number;
  end: number;
  answer: string;
  /** The answer and three distractors, shuffled. */
  options: string[];
  lemma: string;
  gloss: string;
}

/** Listening: hear `text`, pick its translation. */
export interface ListeningRound {
  lineId: number;
  text: string;
  answer: string;
  /** The right translation and three from other lines, shuffled. */
  options: string[];
}

/** Matching: German word ↔ English meaning. */
export interface MatchingPair {
  id: number;
  german: string;
  english: string;
  gender?: Article;
}

export type GameMaterial =
  | { kind: "articles"; items: ArticleItem[] }
  | { kind: "cloze"; rounds: ClozeRound[] }
  | { kind: "listening"; rounds: ListeningRound[] }
  | { kind: "matching"; pairs: MatchingPair[] };

/** How much material there is, so the UI can say what's missing. */
export interface GameAvailability {
  kind: GameKind;
  /** Rounds or items that can be built now. */
  available: number;
  /** What a full game needs. */
  needed: number;
}

export interface GameResultRequest {
  kind: GameKind;
  /** Correct answers (matching: pairs found). */
  score: number;
  /** Questions asked (matching: pairs). */
  total: number;
  durationMs: number;
  /** Wrong answers (matching: wrong taps). */
  mistakes: number;
}

export interface GameRecord {
  kind: GameKind;
  plays: number;
  /** Best score (articles, cloze, listening), or fastest perfect time in ms (matching). */
  best: number | null;
  last: { score: number; total: number; durationMs: number; mistakes: number; playedAt: number } | null;
}

/** Response to POST /api/games/results. */
export interface GameResultResponse {
  record: GameRecord;
  /** This result beat the previous best. */
  newBest: boolean;
}
