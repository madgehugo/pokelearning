/**
 * Word-by-word analysis of a German line: tokenize, look every word up,
 * rank the readings, and link separable verbs to their detached particle
 * ("Ruh dich gut aus" → ausruhen).
 *
 * Ranking is heuristic: German capitalisation (nouns are capitalised, so a
 * lowercase word mid-sentence is not a noun), exact spelling, part of speech
 * and how many meanings a lexeme has (a rough proxy for how common it is).
 */
import type { LineAnalysis, TokenAnalysis, WordSense } from "@pokelearning/shared";
import type { Dictionary, FormMatch } from "../dictionary/db.ts";
import { articlesFor, glossarySense, type Glossary } from "./glossary.ts";
import { isAllCaps, isClauseBoundary, isSentenceEnd, titleCase, tokenize, type Token } from "./tokenize.ts";

export interface AnalyzerDeps {
  dictionary: Dictionary | null;
  glossary: Glossary;
}

const MAX_ALTERNATIVES = 3;
const MAX_GLOSSES = 5;

/** Small preference between parts of speech when everything else is equal. */
const POS_WEIGHT: Record<string, number> = {
  article: 1.5, pron: 0.6, det: 0.6, prep: 0.6, conj: 0.5, contraction: 0.5, verb: 0.5,
  adj: 0.4, adv: 0.4, particle: 0.3, intj: 0.3, num: 0.3, noun: 0.3,
  name: -0.5, abbrev: -0.5, phrase: -1, proverb: -1,
};

interface Candidate {
  match: FormMatch;
  score: number;
}

interface WordContext {
  sentenceStart: boolean;
  /** The token is followed directly by "." (abbreviations like "Prof."). */
  dotFollows: boolean;
}

/** Spelling to look up: Gen 3 capitals become title case ("TRANK" → "Trank"). */
function lookupSpelling(word: string): string {
  return isAllCaps(word) ? titleCase(word) : word;
}

function scoreMatch(match: FormMatch, spelling: string, ctx: WordContext, allCaps: boolean): number {
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

function toSense(c: Candidate, particleUsed: boolean): WordSense {
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
function rank(candidates: Candidate[]): Candidate[] {
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

function candidatesFor(word: string, ctx: WordContext, dict: Dictionary): Candidate[] {
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

interface WordWork {
  index: number;
  analysis: TokenAnalysis;
  candidates: Candidate[];
}

export function analyzeLine(text: string, deps: AnalyzerDeps): LineAnalysis {
  const tokens = tokenize(text);
  const work: (WordWork | null)[] = [];
  const analyses: TokenAnalysis[] = [];

  let sentenceStart = true;
  tokens.forEach((token, index) => {
    const analysis: TokenAnalysis = { text: token.text, start: token.start, end: token.end, kind: token.kind };
    analyses.push(analysis);
    if (token.kind !== "word") {
      work.push(null);
      if (isSentenceEnd(token)) sentenceStart = true;
      else if (token.kind !== "punct") sentenceStart = false;
      return;
    }
    const next = tokens[index + 1];
    const ctx: WordContext = {
      sentenceStart,
      dotFollows: next?.kind === "punct" && next.text === "." && next.start === token.end,
    };
    sentenceStart = false;
    work.push(analyzeWord(token, index, ctx, deps, analysis));
  });

  linkSeparableVerbs(tokens, work, analyses);

  for (const w of work) {
    if (!w || w.analysis.best) continue;
    const ranked = rank(w.candidates);
    if (ranked.length === 0) continue;
    const usesParticle = w.analysis.linkedTo !== undefined;
    w.analysis.best = toSense(ranked[0]!, usesParticle);
    const alts = ranked.slice(1, 1 + MAX_ALTERNATIVES).map((c) => toSense(c, false));
    if (alts.length) w.analysis.alternatives = alts;
  }

  return { lang: "de", tokens: analyses, dictionaryVersion: deps.dictionary?.version ?? null };
}

function analyzeWord(token: Token, index: number, ctx: WordContext, deps: AnalyzerDeps, analysis: TokenAnalysis): WordWork {
  const spelling = lookupSpelling(token.text);
  if (spelling !== token.text) analysis.normalized = spelling;

  const candidates = deps.dictionary ? candidatesFor(token.text, ctx, deps.dictionary) : [];
  const glossary = deps.glossary.get(spelling);
  if (glossary) {
    analysis.best = glossarySense(glossary);
    const alts = rank(candidates).slice(0, MAX_ALTERNATIVES).map((c) => toSense(c, false));
    if (alts.length) analysis.alternatives = alts;
    return { index, analysis, candidates: [] };
  }

  // Hyphenated compound without its own entry: analyse each part.
  if (token.text.includes("-") && !candidates.some((c) => c.score > 0)) {
    let offset = token.start;
    const parts: TokenAnalysis[] = [];
    for (const part of token.text.split("-")) {
      const sub: Token = { text: part, start: offset, end: offset + part.length, kind: "word" };
      const subAnalysis: TokenAnalysis = { text: part, start: sub.start, end: sub.end, kind: "word" };
      const subWork = analyzeWord(sub, index, { ...ctx, sentenceStart: false, dotFollows: false }, deps, subAnalysis);
      const ranked = rank(subWork.candidates);
      if (!subAnalysis.best && ranked[0]) {
        subAnalysis.best = toSense(ranked[0], false);
        const alts = ranked.slice(1, 1 + MAX_ALTERNATIVES).map((c) => toSense(c, false));
        if (alts.length) subAnalysis.alternatives = alts;
      }
      parts.push(subAnalysis);
      offset += part.length + 1;
    }
    analysis.parts = parts;
    return { index, analysis, candidates: [] };
  }

  return { index, analysis, candidates };
}

/**
 * A reading that needs a detached particle ("ruhe" as ausruhen) wins if the
 * particle appears later in the same clause, and loses heavily otherwise.
 */
function linkSeparableVerbs(tokens: Token[], work: (WordWork | null)[], analyses: TokenAnalysis[]): void {
  for (const w of work) {
    if (!w || w.candidates.length === 0) continue;
    const needsParticle = w.candidates.filter((c) => c.match.formParticle);
    if (needsParticle.length === 0) continue;

    let particleIndex = -1;
    let particle: string | null = null;
    for (let j = w.index + 1; j < tokens.length; j++) {
      const t = tokens[j]!;
      if (isClauseBoundary(t)) break;
      if (t.kind !== "word") continue;
      const lower = t.text.toLowerCase();
      if (needsParticle.some((c) => c.match.formParticle === lower)) {
        particleIndex = j;
        particle = lower;
      }
    }

    for (const c of needsParticle) c.score += c.match.formParticle === particle ? 5 : -5;
    const best = rank(w.candidates)[0];
    if (!best || particleIndex < 0 || best.match.formParticle !== particle) continue;

    w.analysis.linkedTo = particleIndex;
    const particleAnalysis = analyses[particleIndex]!;
    const own = work[particleIndex];
    particleAnalysis.linkedTo = w.index;
    particleAnalysis.best = { ...toSense(best, true), formTags: "separated prefix" };
    const ownAlts = own ? rank(own.candidates).slice(0, MAX_ALTERNATIVES).map((c) => toSense(c, false)) : [];
    if (ownAlts.length) particleAnalysis.alternatives = ownAlts;
  }
}
