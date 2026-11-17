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
import type { Dictionary } from "../dictionary/db.ts";
import { analyzeCompound } from "./compound.ts";
import { articlesFor, glossarySense, type Glossary, type GlossaryEntry } from "./glossary.ts";
import { candidatesFor, lookupSpelling, rank, toSense, type Candidate, type WordContext } from "./ranking.ts";
import { isAllCaps, isClauseBoundary, isSentenceEnd, titleCase, tokenize, type Token } from "./tokenize.ts";

export interface AnalyzerDeps {
  dictionary: Dictionary | null;
  glossary: Glossary;
}

const MAX_ALTERNATIVES = 3;

interface WordWork {
  index: number;
  analysis: TokenAnalysis;
  candidates: Candidate[];
  /** A glossary reading offered first among the alternatives (capsOnly names in normal text). */
  extra?: WordSense;
}

export function analyzeLine(text: string, deps: AnalyzerDeps): LineAnalysis {
  const tokens = tokenize(text);
  const work: (WordWork | null)[] = [];
  const analyses: TokenAnalysis[] = [];

  let sentenceStart = true;
  let phraseHead = -1;
  let phraseLast = -1;
  tokens.forEach((token, index) => {
    const analysis: TokenAnalysis = { text: token.text, start: token.start, end: token.end, kind: token.kind };
    analyses.push(analysis);

    // Multi-word names ("BLÜTENBURG CITY"): the first word carries the reading.
    if (index <= phraseLast) {
      analysis.partOf = phraseHead;
      work.push(null);
      return;
    }
    const phrase = deps.glossary.phraseAt(tokens, index, text);
    if (phrase) {
      analysis.best = glossarySense(phrase.entry);
      analysis.phraseEnd = tokens[phrase.last]!.end;
      [phraseHead, phraseLast] = [index, phrase.last];
      sentenceStart = false;
      work.push(null);
      return;
    }

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
  preferRelativePronouns(tokens, work);

  for (const w of work) {
    if (!w || w.analysis.best) continue;
    const ranked = rank(w.candidates);
    if (ranked.length === 0) continue;
    const usesParticle = w.analysis.linkedTo !== undefined;
    w.analysis.best = toSense(ranked[0]!, usesParticle);
    const alts = [...(w.extra ? [w.extra] : []), ...ranked.slice(1).map((c) => toSense(c, false))].slice(
      0,
      MAX_ALTERNATIVES,
    );
    if (alts.length) w.analysis.alternatives = alts;
  }

  return { lang: "de", tokens: analyses, dictionaryVersion: deps.dictionary?.version ?? null };
}

/**
 * An item in the plural ("POKéBÄLLE"): a compound whose last part is a plural
 * the dictionary knows ("Bälle" → Ball), so "Pokébälle" is the item Pokéball.
 */
function itemPlural(spelling: string, deps: AnalyzerDeps): GlossaryEntry | undefined {
  if (!deps.dictionary) return undefined;
  for (let i = 1; i <= spelling.length - 3; i++) {
    const tail = spelling.charAt(i).toUpperCase() + spelling.slice(i + 1);
    for (const m of deps.dictionary.lookup(tail)) {
      if (m.lexeme.pos !== "noun" || m.form !== tail || !m.formTags?.includes("plural")) continue;
      const entry = deps.glossary.get(spelling.slice(0, i) + m.lexeme.lemma.toLowerCase());
      if (entry?.pos === "item") return { ...entry, glosses: [...entry.glosses], plural: spelling };
    }
  }
  return undefined;
}

/**
 * Items are German nouns, but PokéAPI has no genders. Take it from the
 * dictionary ("Trank": der), or from a compound's last element, which decides
 * a German compound's gender ("Supertrank" → Trank → der, "Pokéball" → Ball → der).
 */
function withItemGender(sense: WordSense, candidates: Candidate[], dict: Dictionary | null): WordSense {
  if (sense.pos !== "item" || sense.articles || !dict) return sense;
  const lemma = sense.lemma.toLowerCase();
  const own = candidates.find((c) => c.match.lexeme.pos === "noun" && c.match.lexeme.lemma.toLowerCase() === lemma);
  let gender = own?.match.lexeme.gender ?? null;
  for (let i = 1; !gender && i <= sense.lemma.length - 3; i++) {
    const tail = sense.lemma.slice(i).replace(/^-/, "");
    if (tail.length < 3) break;
    const noun = tail.charAt(0).toUpperCase() + tail.slice(1);
    gender = dict.lookup(noun).find((m) => m.lexeme.pos === "noun" && m.lexeme.lemma === noun)?.lexeme.gender ?? null;
  }
  const articles = articlesFor(gender);
  return gender && articles ? { ...sense, gender, articles } : sense;
}

function analyzeWord(token: Token, index: number, ctx: WordContext, deps: AnalyzerDeps, analysis: TokenAnalysis): WordWork {
  const spelling = lookupSpelling(token.text);
  if (spelling !== token.text) analysis.normalized = spelling;

  const candidates = deps.dictionary ? candidatesFor(token.text, ctx, deps.dictionary) : [];
  const glossary = deps.glossary.get(spelling) ?? (isAllCaps(token.text) ? itemPlural(spelling, deps) : undefined);
  if (glossary?.capsOnly && !isAllCaps(token.text) && candidates.length > 0) {
    // "Glut" in normal text: embers, not the move GLUT (Ember)
    return { index, analysis, candidates, extra: glossarySense(glossary) };
  }
  if (glossary) {
    analysis.best = withItemGender(glossarySense(glossary), candidates, deps.dictionary);
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

  // Compound without its own entry ("Knopfbelegung" → Knopf + Belegung).
  if (deps.dictionary && !candidates.some((c) => c.score > 0)) {
    const parts = analyzeCompound(token, deps.dictionary);
    if (parts) {
      analysis.parts = parts;
      return { index, analysis, candidates: [] };
    }
  }

  return { index, analysis, candidates };
}


const RELATIVE_FORMS = new Set(["der", "die", "das", "dem", "den", "dessen", "deren", "denen"]);
/** What follows a relative pronoun: a pronoun, verb, adverb… but not an adjective or noun ("der alte Mann"). */
const AFTER_RELATIVE = new Set(["pron", "det", "prep", "adv", "verb", "conj", "particle", "num"]);

/**
 * "…das POKéMON, das ich suche": after a comma, der/die/das/den/dem followed by a lowercase
 * word that isn't an adjective starts a relative clause, so the pronoun reading beats the article.
 * "…, das Haus war leer" (a capitalised noun next) stays an article.
 */
function preferRelativePronouns(tokens: Token[], work: (WordWork | null)[]): void {
  for (const w of work) {
    if (!w || !RELATIVE_FORMS.has(tokens[w.index]!.text.toLowerCase())) continue;
    const before = tokens[w.index - 1];
    const next = work[w.index + 1];
    const nextToken = tokens[w.index + 1];
    if (before?.kind !== "punct" || before.text !== "," || !next || nextToken?.kind !== "word") continue;
    if (/^\p{Lu}/u.test(nextToken.text)) continue;
    const nextPos = rank(next.candidates)[0]?.match.lexeme.pos;
    if (!nextPos || !AFTER_RELATIVE.has(nextPos)) continue;
    for (const c of w.candidates) {
      if (c.match.lexeme.pos === "pron") c.score += 4;
      else if (c.match.lexeme.pos === "article") c.score -= 2;
    }
  }
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

    // A detached prefix is the last word of its clause ("Ruh dich gut aus!").
    // Mid-clause it is a preposition: "Er wartet auf dich" is warten + auf, not aufwarten.
    let lastWord = -1;
    for (let j = w.index + 1; j < tokens.length; j++) {
      const t = tokens[j]!;
      if (isClauseBoundary(t)) break;
      if (t.kind === "word") lastWord = j;
    }
    const lower = lastWord >= 0 ? tokens[lastWord]!.text.toLowerCase() : null;
    const matches = lower !== null && needsParticle.some((c) => c.match.formParticle === lower);
    const particleIndex = matches ? lastWord : -1;
    const particle = matches ? lower : null;

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
