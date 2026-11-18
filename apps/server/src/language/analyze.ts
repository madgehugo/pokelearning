/**
 * Word-by-word analysis of a German line: tokenize, look every word up,
 * rank the readings, and link separable verbs to their detached particle
 * ("Ruh dich gut aus" → ausruhen).
 *
 * Ranking is heuristic: German capitalisation (nouns are capitalised, so a
 * lowercase word mid-sentence is not a noun), exact spelling, part of speech
 * and how many meanings a lexeme has (a rough proxy for how common it is).
 */
import type { Language, LineAnalysis, TokenAnalysis, WordSense } from "@pokelearning/shared";
import type { Dictionary } from "../dictionary/db.ts";
import { analyzeCompound } from "./compound.ts";
import { articlesFor, glossarySense, type Glossary, type GlossaryEntry } from "./glossary.ts";
import { candidatesFor, ES_DETERMINERS, lookupSpelling, rank, toSense, type Candidate, type WordContext } from "./ranking.ts";
import { isAllCaps, isClauseBoundary, isSentenceEnd, tokenize, type Token } from "./tokenize.ts";

export interface AnalyzerDeps {
  /** The text's language; German when omitted. */
  lang?: Language;
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
  const lang = deps.lang ?? "de";
  const tokens = tokenize(text);
  const work: (WordWork | null)[] = [];
  const analyses: TokenAnalysis[] = [];

  let sentenceStart = true;
  let afterDeterminer = false;
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
      analysis.best = glossarySense(phrase.entry, lang);
      analysis.phraseEnd = tokens[phrase.last]!.end;
      [phraseHead, phraseLast] = [index, phrase.last];
      sentenceStart = false;
      afterDeterminer = false;
      work.push(null);
      return;
    }

    if (token.kind !== "word") {
      afterDeterminer = false;
      work.push(null);
      if (isSentenceEnd(token)) sentenceStart = true;
      else if (token.kind !== "punct") sentenceStart = false;
      return;
    }
    const next = tokens[index + 1];
    const ctx: WordContext = {
      lang,
      sentenceStart,
      dotFollows: next?.kind === "punct" && next.text === "." && next.start === token.end,
      afterDeterminer,
    };
    sentenceStart = false;
    afterDeterminer = lang === "es" && ES_DETERMINERS.has(token.text.toLowerCase());
    work.push(analyzeWord(token, index, ctx, deps, analysis));
  });

  if (lang === "de") {
    linkSeparableVerbs(tokens, work, analyses);
    preferRelativePronouns(tokens, work);
    preferParticiples(tokens, work);
  } else {
    preferAdjectiveAfterNoun(tokens, work);
  }

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

  return { lang, tokens: analyses, dictionaryVersion: deps.dictionary?.version ?? null };
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

/** "Muchísimas" → mucho: Wiktionary lists few -ísimo forms, so look the plain word up and say so. */
function superlativeCandidates(word: string, ctx: WordContext, dict: Dictionary): Candidate[] | null {
  const stem = word.match(/^(.+?)[íi]sim[oa]s?$/iu)?.[1];
  if (!stem) return null;
  const tail = /^\p{Lu}/u.test(word) && word === word.toUpperCase() ? (c: string) => c.toUpperCase() : (c: string) => c;
  // riquísimo → rico, buenísimo → bueno, grandísimo → grande, facilísimo → fácil
  for (const base of [stem + tail("o"), stem + tail("e"), stem, stem.replace(/qu$/i, "c") + tail("o"), stem.replace(/gu$/i, "g") + tail("o")]) {
    const found = candidatesFor(base, { ...ctx, sentenceStart: false }, dict).filter(
      (c) => (c.match.lexeme.pos === "adj" || c.match.lexeme.pos === "det" || c.match.lexeme.pos === "adv") && c.score > 0,
    );
    if (found.length) {
      return found.map((c) => ({ ...c, match: { ...c.match, form: word, formTags: [c.match.formTags, "superlative"].filter(Boolean).join(" ") } }));
    }
  }
  return null;
}

function analyzeWord(token: Token, index: number, ctx: WordContext, deps: AnalyzerDeps, analysis: TokenAnalysis): WordWork {
  const spelling = lookupSpelling(token.text);
  if (spelling !== token.text) analysis.normalized = spelling;

  let candidates = deps.dictionary ? candidatesFor(token.text, ctx, deps.dictionary) : [];
  if (deps.dictionary && ctx.lang === "es" && !candidates.some((c) => c.score > 0)) {
    candidates = superlativeCandidates(token.text, ctx, deps.dictionary) ?? candidates;
  }
  const glossary = deps.glossary.get(spelling) ?? (isAllCaps(token.text) ? itemPlural(spelling, deps) : undefined);
  if (glossary?.capsOnly && !isAllCaps(token.text) && candidates.length > 0) {
    // "Glut" in normal text: embers, not the move GLUT (Ember)
    return { index, analysis, candidates, extra: glossarySense(glossary, ctx.lang) };
  }
  if (glossary) {
    analysis.best = withItemGender(glossarySense(glossary, ctx.lang), candidates, deps.dictionary);
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
    const parts = ctx.lang === "de" ? analyzeCompound(token, deps.dictionary) : null;
    if (parts) {
      analysis.parts = parts;
      return { index, analysis, candidates: [] };
    }
  }

  return { index, analysis, candidates };
}


/**
 * Spanish puts the adjective after its noun ("PARTIDA NUEVA", "POKéMON salvajes"). A word that can be
 * a noun or an adjective, right after a noun, is the adjective: "nueva" is "nuevo", not "news".
 */
function preferAdjectiveAfterNoun(tokens: Token[], work: (WordWork | null)[]): void {
  for (const w of work) {
    if (!w || w.index === 0) continue;
    const before = work[w.index - 1];
    const gap = tokens[w.index]!.start - tokens[w.index - 1]!.end;
    if (!before || before.analysis.best || gap > 1) continue;
    if (rank(before.candidates)[0]?.match.lexeme.pos !== "noun") continue;
    const adjectives = w.candidates.filter((c) => c.match.lexeme.pos === "adj");
    if (adjectives.length === 0 || !w.candidates.some((c) => c.match.lexeme.pos === "noun")) continue;
    for (const c of adjectives) c.score += 2;
  }
}

/** Forms of haben and werden, which build the perfect and the passive with a participle. */
const PARTICIPLE_AUXILIARIES = new Set([
  "hat", "hast", "habe", "haben", "habt", "hatte", "hatten", "hattest", "hatten", "hätte", "hätten",
  "wird", "wirst", "werde", "werden", "werdet", "wurde", "wurden", "wurdest", "würde", "würden", "worden",
]);

/**
 * "wird in den Kampf geschickt", "hat einen Brief geschickt": a word that is both an adjective and a
 * past participle ("geschickt" is skilled, or sent) is the participle when it ends its clause after
 * haben or werden, or is followed by that auxiliary ("…, weil er es geschickt hat"). With sein it stays
 * ambiguous ("Das war sehr geschickt"), so it is left alone.
 */
function preferParticiples(tokens: Token[], work: (WordWork | null)[]): void {
  for (const w of work) {
    if (!w) continue;
    const participles = w.candidates.filter((c) => c.match.lexeme.pos === "verb" && /\bparticiple\b/.test(c.match.formTags ?? ""));
    if (participles.length === 0 || !w.candidates.some((c) => c.match.lexeme.pos === "adj" || c.match.lexeme.pos === "adv")) continue;
    const next = tokens[w.index + 1];
    const endsClause = !next || (next.kind === "punct" && !/^[„“"”»«]$/.test(next.text)) || (next.kind === "word" && PARTICIPLE_AUXILIARIES.has(next.text.toLowerCase()));
    if (!endsClause) continue;
    let auxBefore = next?.kind === "word"; // followed by the auxiliary itself
    for (let j = w.index - 1; !auxBefore && j >= 0 && !isClauseBoundary(tokens[j]!); j--) {
      if (tokens[j]!.kind === "word" && PARTICIPLE_AUXILIARIES.has(tokens[j]!.text.toLowerCase())) auxBefore = true;
    }
    if (auxBefore) for (const c of participles) c.score += 2.5;
  }
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
