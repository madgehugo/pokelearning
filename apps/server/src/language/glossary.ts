/**
 * Game glossary: terms the dictionary gets wrong or doesn't know (names,
 * abbreviations, items). Entries win over dictionary readings, and `mt`
 * replaces the term before machine translation so "BIRK" comes out as "Birch".
 */
import fs from "node:fs";
import type { Article, WordSense } from "@pokelearning/shared";
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

/** Later entries win, so hand-written terms can override imported names. */
export function createGlossary(entries: GlossaryEntry[]): Glossary {
  const byKey = new Map<string, GlossaryEntry>();
  const phrases = new Map<string, { words: string[]; entry: GlossaryEntry }[]>();
  for (const e of entries) {
    for (const m of e.match) {
      const words = fold(m).split(/\s+/);
      if (words.length === 1) {
        byKey.set(words[0]!, e);
        continue;
      }
      // only plain words and numbers ("Route 101"); punctuation inside a name isn't matched
      if (!words.every((w) => /^[\p{L}\p{M}\p{N}'’-]+$/u.test(w))) continue;
      const list = phrases.get(words[0]!) ?? [];
      const at = list.findIndex((p) => p.words.join(" ") === words.join(" "));
      if (at >= 0) list.splice(at, 1);
      list.push({ words, entry: e });
      list.sort((a, b) => b.words.length - a.words.length);
      phrases.set(words[0]!, list);
    }
  }
  return {
    get: (word) => byKey.get(fold(word)),
    phraseAt(tokens, i, text) {
      const first = tokens[i];
      if (!first || first.kind !== "word") return undefined;
      for (const { words, entry } of phrases.get(fold(first.text)) ?? []) {
        const span = tokens.slice(i, i + words.length);
        if (span.length < words.length) continue;
        const ok = span.every(
          (t, j) =>
            (t.kind === "word" || t.kind === "number") &&
            fold(t.text) === words[j] &&
            (j === 0 || /^\s+$/.test(text.slice(span[j - 1]!.end, t.start))) &&
            (!entry.capsOnly || t.kind === "number" || isAllCaps(t.text)),
        );
        if (ok) return { entry, last: i + words.length - 1 };
      }
      return undefined;
    },
  };
}

export function readGlossaryFile(file: URL | string): GlossaryEntry[] {
  return JSON.parse(fs.readFileSync(file, "utf8")) as GlossaryEntry[];
}

export function loadGlossary(file: URL | string, extra: GlossaryEntry[] = []): Glossary {
  return createGlossary([...extra, ...readGlossaryFile(file)]);
}

export const defaultGlossaryFile = new URL("./glossary/pokemon-de.json", import.meta.url);

const ARTICLE: Record<string, Article> = { m: "der", f: "die", n: "das", pl: "die" };

export function articlesFor(gender: string | null | undefined): Article[] | undefined {
  if (!gender) return undefined;
  const list = [...new Set(gender.split(",").map((g) => ARTICLE[g]).filter((a): a is Article => !!a))];
  return list.length ? list : undefined;
}

export function glossarySense(e: GlossaryEntry): WordSense {
  const articles = articlesFor(e.gender);
  return {
    lemma: e.lemma,
    pos: e.pos,
    ...(e.gender ? { gender: e.gender } : {}),
    ...(articles ? { articles } : {}),
    glosses: e.glosses,
    ...(e.plural ? { formTags: "plural" } : {}),
    source: "glossary",
  };
}
