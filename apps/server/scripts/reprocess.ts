/**
 * Re-analyse and re-translate stored lines, e.g. after importing Pokémon
 * names or rebuilding the dictionary. Translations come from the cache unless
 * the text sent to the translator changed. Stop the server first.
 *
 *   npm run reprocess                    all lines
 *   npm run reprocess -- --no-translate  analysis only
 */
import { config } from "../src/config.ts";
import { AppDb } from "../src/db/app-db.ts";
import { openDictionary } from "../src/dictionary/db.ts";
import { analyzeLine } from "../src/language/analyze.ts";
import { loadGameGlossary } from "../src/language/load.ts";
import { OpusMtProvider } from "../src/translate/opus-mt.ts";
import { Translator } from "../src/translate/translator.ts";

const BATCH = 200;

async function main() {
  const db = new AppDb(config.appDbPath);
  const dictionary = openDictionary(config.dictionaryDbPath);
  const { glossary } = loadGameGlossary();
  const translate = !process.argv.includes("--no-translate") && config.translator === "opus-mt";
  const translator = translate ? new Translator(new OpusMtProvider(config.modelsDir, "de", config.targetLang), db, glossary) : null;

  let seen = 0;
  let analysesChanged = 0;
  let translationsChanged = 0;
  let before: number | undefined;
  for (;;) {
    const lines = db.recentLines(BATCH, before);
    if (lines.length === 0) break;
    for (const line of lines) {
      seen++;
      const lang = line.lang ?? "de";
      if (lang !== "de") continue;
      const analysis = analyzeLine(line.text, { dictionary, glossary });
      if (JSON.stringify(analysis) !== JSON.stringify(line.analysis)) {
        db.saveAnalysis(line.id, analysis);
        analysesChanged++;
      }
      if (translator) {
        const t = await translator.translateLine(line.text, lang, config.targetLang);
        if (t.text !== line.translation?.text) {
          db.saveLineTranslation(line.id, t.provider, t.text);
          translationsChanged++;
          console.log(`  ${line.text}\n    → ${t.text}`);
        }
      }
    }
    before = lines.at(-1)!.id;
  }
  console.log(`${seen} lines: ${analysesChanged} analyses and ${translationsChanged} translations updated`);
  dictionary?.close();
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
