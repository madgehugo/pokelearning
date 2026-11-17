/** Ranking of the dictionary readings of one word: scoring, best-per-lexeme, conversion to a WordSense. */
import type { WordSense } from "@pokelearning/shared";
import type { Dictionary, FormMatch } from "../dictionary/db.ts";
import { articlesFor } from "./glossary.ts";
import { isAllCaps, titleCase } from "./tokenize.ts";

const MAX_GLOSSES = 5;


/** Small preference between parts of speech when everything else is equal. */
const POS_WEIGHT: Record<string, number> = {
  article: 1.5, pron: 0.6, det: 0.6, prep: 0.6, conj: 0.5, contraction: 0.5, verb: 0.5,
  adj: 0.4, adv: 0.4, particle: 0.3, intj: 0.3, num: 0.3, noun: 0.3,
  name: -0.5, abbrev: -0.5, phrase: -1, proverb: -1,
};

export interface Candidate {
  match: FormMatch;
  score: number;
}

export interface WordContext {
  sentenceStart: boolean;
  /** The token is followed directly by "." (abbreviations like "Prof."). */
  dotFollows: boolean;
}

/** Spelling to look up: Gen 3 capitals become title case ("TRANK" → "Trank"). */
export function lookupSpelling(word: string): string {
  return isAllCaps(word) ? titleCase(word) : word;
}

export function scoreMatch(match: FormMatch, spelling: string, ctx: WordContext, allCaps: boolean): number {
  const { lexeme } = match;
  const nounLike = lexeme.pos === "noun" || lexeme.pos === "name";
  let score = 0;

  // At the start of a sentence "Ich" may be "ich" or the noun "das Ich": no preference.
  const lowerFirst = spelling.charAt(0).toLowerCase() + spelling.slice(1);
  if (ctx.sentenceStart && (match.form === spelling || match.form === lowerFirst)) score += 2.5;
  else if (match.form === spelling) score += 3;
  else if (allCaps) score += 2;
  if (match.direct) score += 1;
  if (match.formTags && /\b(archaic|obsolete|dated|dialectal)\b/.test(match.formTags)) score -= 1.5;
  // A form that is only a subjunctive ("führt" as ihr-subjunctive of fahren) loses to a
  // plain present-tense reading of another verb (führen); "möchtest" has no rival, so it stays.
  if (match.formTags && /subjunctive/.test(match.formTags) && !/indicative|imperative|infinitive/.test(match.formTags)) {
    score -= 0.6;
  }

  const capitalised = /^\p{Lu}/u.test(spelling);
  if (!capitalised && nounLike) score -= 3;
  if (capitalised && !ctx.sentenceStart && !allCaps) score += nounLike ? 2 : -1;
  if (allCaps && nounLike) score += 1; // Gen 3 writes names and items in capitals

  // The word is a headword itself ("Leute"), not just an inflection of one ("plural of Leut").
  if (match.form === lexeme.lemma) score += 1.5;
  const outdated = lexeme.senses.filter((s) => s.tags?.some((t) => t === "archaic" || t === "obsolete")).length;
  if (outdated > 0 && outdated === lexeme.senses.length) score -= 1.5;
  score += POS_WEIGHT[lexeme.pos] ?? 0;
  score += Math.min(lexeme.senses.length, 8) * 0.1;
  return score;
}

export function toSense(c: Candidate, particleUsed: boolean): WordSense {
  const { lexeme, formTags } = c.match;
  const articles = articlesFor(lexeme.gender);
  const isLemma = c.match.form.toLowerCase() === lexeme.lemma.toLowerCase();
  return {
    lemma: lexeme.lemma,
    pos: lexeme.pos,
    ...(lexeme.gender ? { gender: lexeme.gender } : {}),
    ...(articles ? { articles } : {}),
    ...(lexeme.plural && lexeme.plural !== lexeme.lemma ? { plural: lexeme.plural } : {}),
    glosses:
      lexeme.pos === "article" && lexeme.lemma === "der"
        ? ["the (definite article)"] // Wiktionary's gloss describes only "der" itself; formTags has the case
        : lexeme.senses.slice(0, MAX_GLOSSES).map((s) => (s.tags ? `${s.gloss} (${s.tags.join(", ")})` : s.gloss)),
    ...(formTags && !isLemma ? { formTags } : {}),
    ...(particleUsed && lexeme.particle ? { particle: lexeme.particle } : {}),
    source: "dictionary",
  };
}

/** Best candidate per lexeme, sorted by score. */
export function rank(candidates: Candidate[]): Candidate[] {
  const best = new Map<number, Candidate>();
  for (const c of candidates) {
    const key = c.match.lexemeId;
    const prev = best.get(key);
    if (!prev || c.score > prev.score || (c.score === prev.score && !prev.match.formTags && c.match.formTags)) {
      best.set(key, c);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

export function candidatesFor(word: string, ctx: WordContext, dict: Dictionary): Candidate[] {
  const spelling = lookupSpelling(word);
  const allCaps = spelling !== word;
  const out: Candidate[] = dict.lookup(spelling).map((match) => ({ match, score: scoreMatch(match, spelling, ctx, allCaps) }));
  if (ctx.dotFollows) {
    for (const match of dict.lookup(`${spelling}.`)) out.push({ match, score: scoreMatch(match, `${spelling}.`, ctx, allCaps) + 1 });
  }
  if (out.length === 0 && /['’]/.test(spelling)) {
    // "hab'" → "hab", "geht’s" → "geht"
    return candidatesFor(spelling.split(/['’]/)[0]!, ctx, dict);
  }
  return out;
}
