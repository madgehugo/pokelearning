/**
 * Game glossary: terms the dictionary gets wrong or doesn't know (names,
 * abbreviations, items). Entries win over dictionary readings, and `mt`
 * replaces the term before machine translation so "BIRK" comes out as "Birch".
 */
import type { Article, Language, WordSense } from "@pokelearning/shared";
import curated from "./glossary/pokemon-de.json" with { type: "json" };
import curatedEs from "./glossary/pokemon-es.json" with { type: "json" };
import { isAllCaps, type Token } from "./tokenize.ts";

export interface GlossaryEntry {
  /** Spellings to match (case-insensitive; Gen 3 capitals are matched too). */
  match: string[];
  lemma: string;
  pos: string;
  gender?: string;
  glosses: string[];
  /** Replacement used in the text sent to the translator. */
  mt?: string;
  /**
   * Only take over words written in Gen 3 capitals ("GLUT" is the move Ember).
   * Otherwise the dictionary reading wins and this one becomes an alternative.
   */
  capsOnly?: boolean;
  /** Set when the entry was matched through a plural form ("Pokébälle"). */
  plural?: string;
}

export interface PhraseMatch {
  entry: GlossaryEntry;
  /** Index of the phrase's last token. */
  last: number;
}

export interface Glossary {
  get(word: string): GlossaryEntry | undefined;
  /** A multi-word entry ("Blütenburg City") starting at token `i`, longest first. */
  phraseAt(tokens: Token[], i: number, text: string): PhraseMatch | undefined;
}

/** Lookup key: case-insensitive, and ß = ss (capitals write "GROSSBRAND" for Großbrand). */
const fold = (word: string) => word.toLowerCase().replace(/ß/g, "ss");

/** One word of a phrase; `dot` when a full stop follows it directly ("DISP." in "DISP. DEMORA"). */
interface Piece {
  word: string;
  dot: boolean;
}

/** Later entries win, so hand-written terms can override imported names. */
export function createGlossary(entries: GlossaryEntry[]): Glossary {
  const byKey = new Map<string, GlossaryEntry>();
  const phrases = new Map<string, { key: string; pieces: Piece[]; entry: GlossaryEntry }[]>();
  for (const e of entries) {
    for (const m of e.match) {
      const words = fold(m).split(/\s+/);
      if (words.length === 1 && !words[0]!.endsWith(".")) {
        byKey.set(words[0]!, e);
        continue;
      }
      // only plain words and numbers ("Route 101"), each optionally followed by a full stop ("Disp. Demora")
      if (!words.every((w) => /^[\p{L}\p{M}\p{N}'’-]+\.?$/u.test(w))) continue;
      const pieces = words.map((w) => ({ word: w.replace(/\.$/, ""), dot: w.endsWith(".") }));
      const key = words.join(" ");
      const list = phrases.get(pieces[0]!.word) ?? [];
      const at = list.findIndex((p) => p.key === key);
      if (at >= 0) list.splice(at, 1);
      list.push({ key, pieces, entry: e });
      list.sort((a, b) => b.pieces.length - a.pieces.length);
      phrases.set(pieces[0]!.word, list);
    }
  }
  return {
    get: (word) => byKey.get(fold(word)),
    phraseAt(tokens, i, text) {
      const first = tokens[i];
      if (first?.kind !== "word") return undefined;
      for (const { pieces, entry } of phrases.get(fold(first.text)) ?? []) {
        let p = i;
        let ok = true;
        for (let j = 0; ok && j < pieces.length; j++) {
          const t = tokens[p];
          ok =
            !!t &&
            (t.kind === "word" || t.kind === "number") &&
            fold(t.text) === pieces[j]!.word &&
            (j === 0 || /^\s+$/.test(text.slice(tokens[p - 1]!.end, t.start))) &&
            (!entry.capsOnly || t.kind === "number" || isAllCaps(t.text));
          p++;
          if (ok && pieces[j]!.dot) {
            const dot = tokens[p];
            ok = !!dot && dot.kind === "punct" && dot.text === "." && dot.start === tokens[p - 1]!.end;
            p++;
          }
        }
        if (ok) return { entry, last: p - 1 };
      }
      return undefined;
    },
  };
}

/** The hand-written game terms. Imported as a module so the packaged app's bundle includes it. */
export const curatedEntries = curated as GlossaryEntry[];

export const curatedEntriesEs = curatedEs as GlossaryEntry[];

/** Imported names (`extra`) plus the hand-written terms of the language, which win. */
export function loadGlossary(extra: GlossaryEntry[] = [], lang: Language = "de"): Glossary {
  return createGlossary([...extra, ...(lang === "de" ? curatedEntries : curatedEntriesEs)]);
}

const ARTICLES: Record<Language, Record<string, Article>> = {
  de: { m: "der", f: "die", n: "das", pl: "die" },
  es: { m: "el", f: "la" },
};

export function articlesFor(gender: string | null | undefined, lang: Language = "de"): Article[] | undefined {
  if (!gender) return undefined;
  const list = [...new Set(gender.split(",").map((g) => ARTICLES[lang][g]).filter((a): a is Article => !!a))];
  return list.length ? list : undefined;
}

export function glossarySense(e: GlossaryEntry, lang: Language = "de"): WordSense {
  const articles = articlesFor(e.gender, lang);
  return {
    lemma: e.lemma,
    pos: e.pos,
    ...(e.gender ? { gender: e.gender } : {}),
    ...(articles ? { articles } : {}),
    glosses: e.glosses,
    ...(e.plural ? { formTags: "plural" } : {}),
    source: "glossary",
    ...(lang !== "de" ? { lang } : {}),
  };
}
