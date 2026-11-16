/**
 * Game glossary: terms the dictionary gets wrong or doesn't know (names,
 * abbreviations, items). Entries win over dictionary readings, and `mt`
 * replaces the term before machine translation so "BIRK" comes out as "Birch".
 */
import fs from "node:fs";
import type { Article, WordSense } from "@pokelearning/shared";

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
}

export interface Glossary {
  get(word: string): GlossaryEntry | undefined;
}

/** Later entries win, so hand-written terms can override imported names. */
export function createGlossary(entries: GlossaryEntry[]): Glossary {
  const byKey = new Map<string, GlossaryEntry>();
  for (const e of entries) for (const m of e.match) byKey.set(m.toLowerCase(), e);
  return { get: (word) => byKey.get(word.toLowerCase()) };
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
    source: "glossary",
  };
}
