/** Terminal output for processed lines (the UI replaces this in phase 3). */
import { styleText } from "node:util";
import type { ProcessedLine, TokenAnalysis, WordSense } from "@pokelearning/shared";

export const time = () => new Date().toLocaleTimeString("de-DE", { hour12: false });

const POS_LABEL: Record<string, string> = {
  noun: "noun", verb: "verb", adj: "adj.", adv: "adv.", pron: "pron.", det: "det.", article: "article",
  prep: "prep.", conj: "conj.", contraction: "contr.", intj: "interj.", name: "name", num: "num.",
  abbrev: "abbr.", particle: "particle", phrase: "phrase",
};

function describeSense(s: WordSense): string {
  const head = s.articles && s.pos === "noun" ? `${s.articles.join("/")} ${s.lemma}` : s.lemma;
  const details = [POS_LABEL[s.pos] ?? s.pos, s.plural ? `pl. ${s.plural}` : null].filter(Boolean).join(", ");
  const gloss = s.glosses.slice(0, 2).join("; ");
  return `${styleText("bold", head)} ${styleText("dim", `(${details})`)} ${gloss}`;
}

function wordRows(tokens: TokenAnalysis[]): [string, string][] {
  const rows: [string, string][] = [];
  for (const t of tokens) {
    if (t.kind !== "word") continue;
    if (t.parts) {
      rows.push([t.text, styleText("dim", "compound:")]);
      for (const p of t.parts) rows.push([`  ${p.text}`, p.best ? describeSense(p.best) : styleText("dim", "?")]);
      continue;
    }
    if (!t.best) {
      rows.push([t.text, styleText("dim", "not in dictionary")]);
      continue;
    }
    const form = t.best.formTags ? styleText("dim", `  · ${t.best.formTags.split("; ")[0]}`) : "";
    rows.push([t.text, describeSense(t.best) + form]);
  }
  return rows;
}

export function printLine(line: ProcessedLine): void {
  const source = line.source ? `/${line.source}` : "";
  const seen = line.seenBefore ? `, seen ${line.seenBefore}× before` : "";
  console.log(styleText("dim", `[${time()}] #${line.id} ${line.game}${source}${seen}`));
  console.log("  " + styleText("bold", line.text));
  if (line.translation) {
    const cached = line.translation.cached ? " (cached)" : "";
    console.log("  " + styleText("green", line.translation.text) + styleText("dim", cached));
  }
  if (line.analysis) {
    const rows = wordRows(line.analysis.tokens);
    const width = Math.min(18, Math.max(...rows.map(([w]) => w.length), 0));
    for (const [word, desc] of rows) console.log(`    ${word.padEnd(width)}  ${desc}`);
  }
  console.log();
}
