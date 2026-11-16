/** Text helpers shared by server and UI. */

/**
 * Short gloss for scanning: drop parenthetical explanations from long glosses.
 * "people (several individual persons, …), folk" → "people, folk";
 * "great heat from (or as if from) something that glows" → "great heat from something that glows".
 */
export function shortGloss(gloss: string | undefined): string {
  if (!gloss) return "";
  if (gloss.length <= 48) return gloss;
  const short = gloss.replace(/\s*\([^()]*\)/g, "").replace(/\s+([,;.])/g, "$1").trim();
  return short || gloss;
}
