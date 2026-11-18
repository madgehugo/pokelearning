/**
 * Turn game text into something a general-purpose translator handles well:
 *
 * - Gen 3 capitals become normal spelling ("POKéMON" → "Pokémon").
 * - Glossary terms (Pokémon, moves, KP…) become numbered placeholders X1, X2…
 *   and go back in as English after translation. Opus-MT garbles English
 *   names inside German text ("Scratch" → "SStitch") but copies X1 reliably,
 *   and "X1 setzt X2 ein!" is one cache entry for every Pokémon and move.
 * - One sentence per request: Opus-MT tends to drop short sentences such as
 *   "Hallo!" when given several.
 */
import type { Glossary } from "../language/glossary.ts";
import { isAllCaps, titleCase, tokenize } from "../language/tokenize.ts";

/** Acronyms Gen 3 uses that must stay in capitals: KP, AP, VM, TM, PC… */
const MAX_ACRONYM_LENGTH = 3;

const ABBREVIATIONS = ["Prof.", "Dr.", "Nr.", "St.", "z.B.", "usw.", "bzw.", "ca.", "Sr.", "Sra.", "Srta.", "Dra."];

/** Game phrases the tokenizer splits up, protected as a whole. */
const PHRASES_DE: [RegExp, string][] = [
  [/\bE\.-Punkte\b/g, "Exp. Points"],
  // Stat names on the summary screen and in battle ("INIT. von X sinkt."). The full stops are part
  // of the abbreviation, not sentence ends. Longest first: "SP. ANG." before "ANG.".
  [/\bSP\.\s*ANG\./g, "Sp. Atk"],
  [/\bSP\.\s*VER(?:T)?\./g, "Sp. Def"],
  [/\bANG\./g, "Attack"],
  [/\bVERT\./g, "Defense"],
  [/\bINIT\./g, "Speed"],
  // Battle menu labels, which are only ever written in capitals
  [/\bKAMPF\b/g, "Fight"],
  [/\bBEUTEL\b/g, "Bag"],
  [/\bFLUCHT\b/g, "Run"],
];

/** The same for Spanish games (the labels found in the Esmeralda ROM). */
const PHRASES_ES: [RegExp, string, string?][] = [
  // the options screen and the trainer card; longer labels first
  [/\bVELOC\.\s*TEXTO\b/g, "Text Speed"],
  [/\bANIM\.\s*COMBATE\b/g, "Battle Scene"],
  [/\bTIPO\s+COMBATE\b/g, "Battle Style"],
  [/\bCONTROLES\b/g, "Button Mode"],
  [/\bIMAGEN\b/g, "Frame"],
  [/\bLENTA\b/g, "Slow"],
  [/\bMEDIA\b/g, "Mid"],
  [/\bRÁPIDA(?![\p{L}])/gu, "Fast"],
  [/\bCAMBIAR\b/g, "Shift"],
  [/\bMANTENER\b/g, "Set"],
  [/\bMONO\b/g, "Mono"],
  [/\bTIEMPO\s+J\./g, "Play Time"],
  [/\bMEDALLAS\b/g, "Badges"],
  [/\bOBJETOS\b/g, "Items"],
  [/\bMT\s*\/\s*MO\b/g, "TMs/HMs"],
  [/\bENTRENADOR(?![\p{L}])/gu, "Trainer"],
  // Stat names: a label on its own is the game's English abbreviation; inside a sentence it is spelt
  // out in Spanish (third item), so the translator gets the grammar right ("¡Velocidad de X1 bajó!").
  [/\bAT\.\s*ESP\./g, "Sp. Atk", "ataque especial"],
  [/\bDEF\.\s*ESP\./g, "Sp. Def", "defensa especial"],
  [/\bVELOCID\./g, "Speed", "velocidad"],
  [/\bVELOC\./g, "Speed", "velocidad"],
  [/\bPS\b/g, "HP"],
  [/\bLUCHA\b/g, "Fight"],
  [/\bMOCHILA\b/g, "Bag"],
  [/\bHUIDA\b/g, "Run"],
];

const PHRASES: Record<string, [RegExp, string, string?][]> = { de: PHRASES_DE, es: PHRASES_ES };

const SLOT = /\bX(\d+)\b/g;

/** A sentence for the translator, with the English text for each placeholder. */
export interface PreparedSentence {
  /** e.g. "X1 setzt X2 ein!" (this is also the cache key) */
  text: string;
  /** slots[0] replaces X1, slots[1] X2, … */
  slots: string[];
}

/** The whole line with placeholders numbered across the line. */
function protect(text: string, glossary: Glossary, lang: string): { text: string; slots: string[] } {
  // Text that already contains X1-like words can't use placeholders safely.
  const useSlots = !SLOT.test(text);
  SLOT.lastIndex = 0;
  const slots: string[] = [];
  const slot = (english: string) => {
    if (!useSlots) return english;
    slots.push(english);
    return `X${slots.length}`;
  };

  for (const [re, english, spelledOut] of PHRASES[lang] ?? []) {
    const alone = spelledOut !== undefined && new RegExp(`^(?:${re.source})$`).test(text.trim());
    text = text.replace(re, (match: string, offset: number, whole: string) => {
      if (spelledOut === undefined || alone) return slot(english);
      const start = /(?:^|[¡¿.!?]\s*)$/.test(whole.slice(0, offset));
      // the abbreviation's full stop may also be the end of the sentence
      const end = /^\s*$/.test(whole.slice(offset + match.length)) ? "." : "";
      return (start ? spelledOut[0]!.toUpperCase() + spelledOut.slice(1) : spelledOut) + end;
    });
  }

  let out = "";
  let last = 0;
  const tokens = tokenize(text);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind !== "word" || /^X\d+$/.test(t.text)) continue;
    const phrase = glossary.phraseAt(tokens, i, text);
    if (phrase?.entry.mt) {
      out += text.slice(last, t.start) + slot(phrase.entry.mt);
      last = tokens[phrase.last]!.end;
      i = phrase.last;
      continue;
    }
    let replacement: string | undefined;
    const spelling = isAllCaps(t.text) ? titleCase(t.text) : t.text;
    const entry = glossary.get(spelling);
    if (entry?.mt && (!entry.capsOnly || isAllCaps(t.text))) replacement = slot(entry.mt);
    else if (isAllCaps(t.text) && t.text.length > MAX_ACRONYM_LENGTH) replacement = spelling;
    if (replacement !== undefined) {
      out += text.slice(last, t.start) + replacement;
      last = t.end;
    }
  }
  return { text: out + text.slice(last), slots };
}

/** Split a line into sentences ready for the translator, placeholders numbered per sentence. */
export function prepareSentences(text: string, glossary: Glossary, lang = "de"): PreparedSentence[] {
  const line = protect(text, glossary, lang);
  if (line.slots.length === 0) return splitSentences(line.text).map((s) => ({ text: s, slots: [] }));
  return splitSentences(line.text).map((sentence) => {
    const slots: string[] = [];
    const renumbered = sentence.replace(SLOT, (_, n: string) => {
      slots.push(line.slots[Number(n) - 1]!);
      return `X${slots.length}`;
    });
    return { text: renumbered, slots };
  });
}

/**
 * Put the English text back. Returns null if the translation lost a placeholder.
 * The translator picked "a" or "an" for "X1", so it is fixed for the real name
 * ("an X1" → "a Super Potion", "a X1" → "an Ember").
 */
export function restoreSlots(translated: string, slots: string[]): string | null {
  for (let i = 0; i < slots.length; i++) {
    if (!new RegExp(`\\bX${i + 1}\\b`).test(translated)) return null;
  }
  return translated
    .replace(/\b([Aa])n? (X(\d+))\b/g, (match, a: string, slot: string, n: string) => {
      const name = slots[Number(n) - 1];
      if (name === undefined) return match;
      return `${/^[aeiou]/i.test(name) ? `${a}n` : a} ${slot}`;
    })
    .replace(SLOT, (match, n: string) => slots[Number(n) - 1] ?? match);
}

/** The sentence with the English text in place of the placeholders (fallback input). */
export function fillSlots(sentence: PreparedSentence): string {
  return sentence.text.replace(SLOT, (match, n: string) => sentence.slots[Number(n) - 1] ?? match);
}

/** The text the translator sees for a whole line, for display and tests. */
export function prepareForTranslation(text: string, glossary: Glossary, lang = "de"): string {
  return prepareSentences(text, glossary, lang)
    .map((s) => s.text)
    .join(" ");
}

/** Split into sentences, keeping abbreviations like "Prof." intact. */
export function splitSentences(text: string): string[] {
  const protectedText = ABBREVIATIONS.reduce((s, abbr) => s.replaceAll(abbr, abbr.replaceAll(".", "\u0000")), text);
  return protectedText
    .split(/(?<=[.!?…])\s+(?=\S)/u)
    .map((s) => s.replaceAll("\u0000", ".").trim())
    .filter(Boolean);
}
