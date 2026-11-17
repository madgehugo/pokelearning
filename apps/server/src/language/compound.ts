/** Splitting a word the dictionary lacks into known parts ("Pokémonzentrum" → Pokémon + Zentrum). */
import type { TokenAnalysis, WordSense } from "@pokelearning/shared";
import type { Dictionary } from "../dictionary/db.ts";
import { candidatesFor, rank, toSense } from "./ranking.ts";
import type { Token } from "./tokenize.ts";

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
  const ranked = rank(candidatesFor(text, { lang: "de", sentenceStart: false, dotFollows: false }, dict)).filter(
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

export function analyzeCompound(token: Token, dict: Dictionary): TokenAnalysis[] | null {
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
