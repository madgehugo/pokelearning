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

/** One label of a menu screen, with where it sits in the line's text and its translation. */
export interface MenuRow {
  start: number;
  end: number;
  translation: string;
}

/**
 * For a line from a menu screen: one label per line of `text`, translated one label per line
 * (see the pipeline). Pairs them up, or returns null if they don't line up, in
 * which case the whole translation should be shown as one block.
 */
export function menuRows(line: { source?: string; text: string; translation: { text: string } | null }): MenuRow[] | null {
  if (line.source !== "menu" || !line.translation) return null;
  const { text } = line;
  const translation = line.translation.text;
  const labels: { start: number; end: number }[] = [];
  let start = 0;
  for (const part of text.split("\n")) {
    if (part.trim()) labels.push({ start, end: start + part.length });
    start += part.length + 1;
  }
  const translations = translation.split("\n").filter((t) => t.trim());
  if (labels.length < 2 || labels.length !== translations.length) return null;
  return labels.map((l, i) => ({ ...l, translation: translations[i]! }));
}
