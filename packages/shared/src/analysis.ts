/**
 * Language pipeline output: what the server knows about a received line.
 * Produced in phase 2, consumed by the web UI in phase 3.
 */

/** Definite articles: German der/die/das, Spanish el/la. */
export type Article = "der" | "die" | "das" | "el" | "la";

/** Languages the app can analyse (the game text's language). */
export type Language = "de" | "es";

/** One dictionary reading of a word. */
export interface WordSense {
  /** Dictionary form, e.g. "Haus", "mögen", "ausruhen". */
  lemma: string;
  /** Part of speech as in Wiktionary: noun, verb, adj, adv, article, pron, prep, name, … */
  pos: string;
  /** Noun gender: "m", "f", "n", "pl" (plural only), or combinations like "m,n". */
  gender?: string;
  /** Definite article(s) for the gender, e.g. ["der"] or ["der", "das"]. */
  articles?: Article[];
  /** Nominative plural for nouns. */
  plural?: string;
  /** English meanings, most common first. */
  glosses: string[];
  /** Grammatical description of the form as it appeared, e.g. "dative plural". */
  formTags?: string;
  /** Separable verb prefix if this reading is a separable verb ("aus" in ausruhen). */
  particle?: string;
  source: "dictionary" | "glossary" | "derived";
}

export interface TokenAnalysis {
  text: string;
  /** Character offsets in the line. */
  start: number;
  end: number;
  kind: "word" | "number" | "punct" | "placeholder";
  /** Spelling used for lookup if it differs, e.g. "POKéMON" → "Pokémon". */
  normalized?: string;
  best?: WordSense;
  alternatives?: WordSense[];
  /** Hyphenated compounds without a dictionary entry are analysed part by part. */
  parts?: TokenAnalysis[];
  /** Index of the token this one belongs to as a separable-verb particle (or vice versa). */
  linkedTo?: number;
  /** Multi-word name ("BLÜTENBURG CITY"): on its first word, the end offset of the whole name. */
  phraseEnd?: number;
  /** On the other words of a multi-word name: index of its first word. */
  partOf?: number;
}

export interface LineAnalysis {
  lang: string;
  tokens: TokenAnalysis[];
  /** Dictionary build used, so stale analyses can be recomputed. */
  dictionaryVersion: string | null;
}

export interface Translation {
  provider: string;
  from: string;
  to: string;
  text: string;
  cached: boolean;
}

/** A received line after the server processed it (what the UI will receive). */
export interface ProcessedLine {
  id: number;
  game: string;
  source?: string;
  lang?: string;
  text: string;
  /** Unix epoch milliseconds when the server received the line. */
  receivedAt: number;
  analysis: LineAnalysis | null;
  translation: Translation | null;
  /** How many times this exact text came up before this line (same game, all sessions). */
  seenBefore: number;
}
