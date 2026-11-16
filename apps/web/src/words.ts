/** Presentation helpers for analysed words. */
import type { TokenAnalysis, WordSense } from "@pokelearning/shared";

export type GenderKey = "der" | "die" | "das" | "mixed";

/** Colour key for a reading: one article → its colour; several (der/das) → neutral. */
export function genderKey(sense: Pick<WordSense, "articles" | "pos"> | undefined): GenderKey | undefined {
  if (!sense?.articles || (sense.pos !== "noun" && sense.pos !== "name")) return undefined;
  return sense.articles.length === 1 ? sense.articles[0] : "mixed";
}

/** "die Leute", "der/das Leut", "ausruhen". */
export function headword(sense: Pick<WordSense, "articles" | "pos" | "lemma">): string {
  return sense.articles && sense.pos === "noun" ? `${sense.articles.join("/")} ${sense.lemma}` : sense.lemma;
}

const POS: Record<string, string> = {
  noun: "noun", name: "name", verb: "verb", adj: "adjective", adv: "adverb", pron: "pronoun",
  det: "determiner", article: "article", prep: "preposition", conj: "conjunction",
  contraction: "contraction", intj: "interjection", num: "number", abbrev: "abbreviation",
  particle: "particle", phrase: "phrase", pokemon: "Pokémon", move: "move",
};
export const posLabel = (pos: string) => POS[pos] ?? pos;

const TAGS: Record<string, string> = {
  "first-person": "1st person", "second-person": "2nd person", "third-person": "3rd person",
  "subjunctive-i": "subjunctive I", "subjunctive-ii": "subjunctive II",
};

/** Wiktionary sorts tags alphabetically; learners read person, gender, number, then case. */
const GROUPS = [
  ["first-person", "second-person", "third-person"],
  ["masculine", "feminine", "neuter"],
  ["singular", "plural"],
];
const CASES = ["nominative", "accusative", "dative", "genitive"];
const DROPPED = new Set(["definite", "indefinite", "personal", "canonical"]);

/**
 * "accusative definite feminine nominative singular; …"
 *   → "feminine singular, nominative or accusative"
 */
export function describeForm(tags: string | undefined): string | undefined {
  const first = tags?.split("; ")[0];
  if (!first) return undefined;
  if (first === "separated prefix") return first;
  const set = new Set(first.split(" ").filter((t) => !DROPPED.has(t)));
  const label = (t: string) => TAGS[t] ?? t.replaceAll("-", " ");
  const head = GROUPS.flatMap((g) => g.filter((t) => set.has(t))).map(label);
  const cases = CASES.filter((t) => set.has(t));
  const rest = [...set].filter((t) => !GROUPS.flat().includes(t) && !CASES.includes(t)).map(label);
  const parts = [[...head, ...rest].join(" "), cases.join(" or ")].filter(Boolean);
  return parts.join(", ") || undefined;
}

/**
 * Short gloss for scanning: drop parenthetical explanations from long glosses.
 * "people (several individual persons, …), folk" → "people, folk";
 * "great heat from (or as if from) something that glows" → "great heat from something that glows".
 */
export function shortGloss(gloss: string | undefined): string {
  if (!gloss) return "";
  if (gloss.length <= 48) return gloss;
  const short = gloss.replace(/\s*\([^()]*\)/g, "").replace(/\s+([,;.])/g, "$1").trim();
  return short || gloss;
}

/** Parts of speech whose case/number form is the main thing to learn. */
export const FORM_MATTERS = new Set(["pron", "article", "det"]);

export interface WordEntry {
  index: number;
  token: TokenAnalysis;
}

export function wordsOf(tokens: TokenAnalysis[]): WordEntry[] {
  return tokens.flatMap((token, index) => (token.kind === "word" ? [{ index, token }] : []));
}

export const GAME_NAMES: Record<string, string> = {
  "pokemon-emerald-de": "Pokémon Smaragd",
  "pokemon-emerald-en": "Pokémon Emerald",
};

/** "now", "in 10 min", "in 3 days", "3 days ago". */
export function relativeTime(ms: number, now = Date.now()): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  if (abs < 60_000) return "now";
  const min = Math.round(abs / 60_000);
  const text =
    min < 60
      ? `${min} min`
      : min < 60 * 24
        ? `${Math.round(min / 60)} h`
        : `${Math.round(min / 1440)} ${Math.round(min / 1440) === 1 ? "day" : "days"}`;
  return diff > 0 ? `in ${text}` : `${text} ago`;
}
