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
import { articlesFor, glossarySense, type Glossary, type GlossaryEntry } from "./glossary.ts";
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

/** Linking elements between the parts of a compound: Geburt-s-tag, Hund-e-hütte. */
const LINKING = ["", "s", "es", "n", "en", "e", "er", "ens"];
const MIN_HEAD = 4;
const MIN_TAIL = 3; // "Tag", "Ort", "Weg"
const PART_POS = new Set(["noun", "adj"]);

interface Split {
  /** [start, end) in the word, and the end of the part's own word without the linking element. */
  start: number;
  end: number;
  stem: number;
}

/** The reading of one part of a compound, or undefined if it isn't a word the dictionary knows. */
function partSense(text: string, dict: Dictionary, final: boolean): WordSense | undefined {
  const ranked = rank(candidatesFor(text, { sentenceStart: false, dotFollows: false }, dict)).filter(
    (c) => (final ? c.match.lexeme.pos === "noun" : PART_POS.has(c.match.lexeme.pos)) && c.match.form.toLowerCase() === text.toLowerCase(),
  );
  if (ranked[0]) return toSense(ranked[0], false);
  // "Belegung" has no entry, but belegen does: a noun in -ung is always feminine and means the act or result.
  const lower = text.toLowerCase();
  if (final && lower.length >= 7 && lower.endsWith("ung")) {
    const stem = lower.slice(0, -3);
    for (const infinitive of [`${stem}en`, `${stem}n`]) {
      const verb = dict.lookup(infinitive).find((m) => m.lexeme.pos === "verb" && m.form.toLowerCase() === infinitive);
      if (!verb) continue;
      const lemma = text.charAt(0).toUpperCase() + lower.slice(1);
      return {
        lemma,
        pos: "noun",
        gender: "f",
        articles: ["die"],
        glosses: [`the act or result of ${verb.lexeme.lemma} (${verb.lexeme.senses.slice(0, 2).map((s) => s.gloss).join("; ")})`],
        source: "derived",
      };
    }
  }
  return undefined;
}

/**
 * Split an unknown word into dictionary words, last part a noun: the best split has the
 * longest shorter half. Parts may themselves be compounds ("Kampfstilwechsel").
 */
function splitCompound(text: string, from: number, dict: Dictionary, depth = 0): { split: Split; sense: WordSense }[] | null {
  const lower = text.toLowerCase();
  let best: { parts: { split: Split; sense: WordSense }[]; quality: number } | null = null;
  for (let i = MIN_HEAD; i <= lower.length - MIN_TAIL; i++) {
    for (const link of LINKING) {
      const stemEnd = i - link.length;
      if (stemEnd < MIN_HEAD || lower.slice(stemEnd, i) !== link) continue;
      const head = partSense(text.slice(0, stemEnd), dict, false);
      if (!head) continue;
      const tailText = text.slice(i);
      const tail = partSense(tailText, dict, true);
      const tailParts = tail
        ? [{ split: { start: from + i, end: from + text.length, stem: from + text.length }, sense: tail }]
        : depth < 2 ? splitCompound(tailText, from + i, dict, depth + 1) : null;
      if (!tailParts) continue;
      const quality = Math.min(stemEnd, lower.length - i) - (link ? 0.5 : 0) - tailParts.length * 0.1;
      if (!best || quality > best.quality) {
        best = { parts: [{ split: { start: from, end: from + i, stem: from + stemEnd }, sense: head }, ...tailParts], quality };
      }
    }
  }
  return best?.parts ?? null;
}

function analyzeCompound(token: Token, dict: Dictionary): TokenAnalysis[] | null {
  if (token.text.length < MIN_HEAD + MIN_TAIL + 1 || /[^\p{L}]/u.test(token.text)) return null;
  const parts = splitCompound(token.text, 0, dict);
  if (!parts) return null;
  return parts.map(({ split, sense }) => ({
    text: token.text.slice(split.start, split.end),
    start: token.start + split.start,
    end: token.start + split.end,
    kind: "word" as const,
    best: sense,
  }));
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
