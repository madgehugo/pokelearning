/**
 * Turn game text into something a general-purpose translator handles well:
 * Gen 3 capitals → normal spelling ("POKéMON" → "Pokémon"), glossary names
 * → English names ("BIRK" → "Birch"), and one sentence per request (Opus-MT
 * tends to drop short sentences such as "Hallo!" when given several).
 */
import type { Glossary } from "../language/glossary.ts";
import { isAllCaps, titleCase, tokenize } from "../language/tokenize.ts";

/** Acronyms Gen 3 uses that must stay in capitals: KP, AP, VM, TM, PC… */
const MAX_ACRONYM_LENGTH = 3;

const ABBREVIATIONS = ["Prof.", "Dr.", "Nr.", "St.", "z.B.", "usw.", "bzw.", "ca."];

export function prepareForTranslation(text: string, glossary: Glossary): string {
  let out = "";
  let last = 0;
  for (const t of tokenize(text)) {
    if (t.kind !== "word") continue;
    let replacement: string | undefined;
    const spelling = isAllCaps(t.text) ? titleCase(t.text) : t.text;
    const entry = glossary.get(spelling);
    if (entry?.mt) replacement = entry.mt;
    else if (isAllCaps(t.text) && t.text.length > MAX_ACRONYM_LENGTH) replacement = spelling;
    if (replacement !== undefined) {
      out += text.slice(last, t.start) + replacement;
      last = t.end;
    }
  }
  return out + text.slice(last);
}

/** Split into sentences, keeping abbreviations like "Prof." intact. */
export function splitSentences(text: string): string[] {
  const protectedText = ABBREVIATIONS.reduce((s, abbr) => s.replaceAll(abbr, abbr.replaceAll(".", "\u0000")), text);
  return protectedText
    .split(/(?<=[.!?…])\s+(?=\S)/u)
    .map((s) => s.replaceAll("\u0000", ".").trim())
    .filter(Boolean);
}
