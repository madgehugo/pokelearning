/**
 * German tokenizer for game dialogue. Keeps hyphenated compounds
 * ("POKéMON-Center") and apostrophe forms ("geht's") together, and treats
 * adapter placeholders ("{PLAYER}") as single tokens.
 */

export type TokenKind = "word" | "number" | "punct" | "placeholder";

export interface Token {
  text: string;
  start: number;
  end: number;
  kind: TokenKind;
}

const WORD = String.raw`[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)?`;
const TOKEN_RE = new RegExp(
  String.raw`(?<placeholder>\{[A-Z0-9_]+\})|(?<word>${WORD}(?:-${WORD})*)|(?<number>\p{N}+(?:[.,]\p{N}+)*)|(?<punct>\S)`,
  "gu",
);

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const groups = m.groups!;
    const kind = (Object.keys(groups) as TokenKind[]).find((k) => groups[k] !== undefined)!;
    tokens.push({ text: m[0], start: m.index!, end: m.index! + m[0].length, kind });
  }
  return tokens;
}

/** Words written in capitals, as Gen 3 games do for names: "POKéMON", "TRANK", "BIRK". */
export function isAllCaps(word: string): boolean {
  const upper = word.match(/\p{Lu}/gu)?.length ?? 0;
  // Gen 3 writes "POKéMON" with a lowercase é
  const lower = word.replace(/é/g, "").match(/\p{Ll}/gu)?.length ?? 0;
  return upper >= 2 && lower === 0;
}

/** "POKéMON" → "Pokémon", "POKéMON-CENTER" → "Pokémon-Center". */
export function titleCase(word: string): string {
  return word
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("-");
}

/** True for tokens that end a clause (used for separable verbs). */
export const isClauseBoundary = (t: Token) => t.kind === "punct" && /[.!?;:,…]/.test(t.text);

/** True for tokens after which a new sentence starts. */
export const isSentenceEnd = (t: Token) => t.kind === "punct" && /[.!?…:¿¡]/.test(t.text);
