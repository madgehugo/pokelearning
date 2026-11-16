/**
 * Build data/dictionary.db from the Kaikki.org German extract of English
 * Wiktionary (CC BY-SA). Downloads the extract (~100 MB) on first run.
 *
 *   npm run dict:import            build (download if needed)
 *   npm run dict:import -- --fresh re-download the extract first
 */
import path from "node:path";
import { config } from "../src/config.ts";
import { importDictionary } from "../src/setup/dictionary.ts";

let last = "";
const started = Date.now();
importDictionary(config, (fraction, detail) => {
  const line = `${fraction === null ? "" : `${Math.round(fraction * 100)}% `}${detail}`;
  if (line !== last) process.stdout.write(`\r${line.padEnd(70)}`);
  last = line;
}, { fresh: process.argv.includes("--fresh") }).then(
  (r) => {
    console.log(
      `\nbuilt ${path.relative(process.cwd(), config.dictionaryDbPath)} (${r.version}): ` +
        `${r.lexemes} lexemes, ${r.forms} forms in ${((Date.now() - started) / 1000).toFixed(0)} s`,
    );
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
