/**
 * Build data/dictionary.db (German) or data/dictionary-es.db (Spanish) from the
 * Kaikki.org extract of English Wiktionary (CC BY-SA). Downloads the extract
 * (~100 MB) on first run.
 *
 *   npm run dict:import            build German (download if needed)
 *   npm run dict:import -- es      build Spanish
 *   npm run dict:import -- --fresh re-download the extract first
 */
import path from "node:path";
import { config } from "../src/config.ts";
import type { Language } from "@pokelearning/shared";
import { importDictionary } from "../src/setup/dictionary.ts";

const language = (process.argv.includes("es") ? "es" : "de") satisfies Language;
const paths = config.languages[language];
let last = "";
const started = Date.now();
importDictionary(paths, (fraction, detail) => {
  const line = `${fraction === null ? "" : `${Math.round(fraction * 100)}% `}${detail}`;
  if (line !== last) process.stdout.write(`\r${line.padEnd(70)}`);
  last = line;
}, { fresh: process.argv.includes("--fresh") }).then(
  (r) => {
    console.log(
      `\nbuilt ${path.relative(process.cwd(), paths.dictionaryDbPath)} (${r.version}): ` +
        `${r.lexemes} lexemes, ${r.forms} forms in ${((Date.now() - started) / 1000).toFixed(0)} s`,
    );
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
