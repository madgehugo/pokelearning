/**
 * Pokélearning server.
 *
 * adapter (TCP, NDJSON) → ingest → pipeline (store, analyse, translate) → terminal
 *
 * Phase 3 adds a WebSocket that forwards the pipeline's "line" events to the UI.
 */
import { styleText } from "node:util";
import { config } from "./config.ts";
import { AppDb } from "./db/app-db.ts";
import { openDictionary } from "./dictionary/db.ts";
import { createIngestServer } from "./ingest/tcp.ts";
import { defaultGlossaryFile, loadGlossary } from "./language/glossary.ts";
import { LinePipeline } from "./pipeline.ts";
import { printLine, time } from "./print.ts";
import { OpusMtProvider } from "./translate/opus-mt.ts";
import { Translator } from "./translate/translator.ts";

const info = (text: string) => console.log(styleText("cyan", `[${time()}] ${text}`));
const warn = (text: string) => console.warn(styleText("yellow", `[${time()}] ${text}`));

const db = new AppDb(config.appDbPath);
const glossary = loadGlossary(defaultGlossaryFile);
const dictionary = openDictionary(config.dictionaryDbPath);
if (dictionary) info(`dictionary ${dictionary.version}`);
else warn("no dictionary found: run `npm run dict:import` for the word-by-word breakdown");

let translator: Translator | null = null;
if (config.translator === "opus-mt") {
  translator = new Translator(new OpusMtProvider(config.modelsDir, "de", config.targetLang), db, glossary);
  const started = Date.now();
  info(`loading translation model ${translator.providerId} (first run downloads ~110 MB)…`);
  translator.warmUp().then(
    () => info(`translation model ready (${((Date.now() - started) / 1000).toFixed(1)} s)`),
    (err: Error) => warn(`translation model failed to load: ${err.message}. Lines will be shown untranslated.`),
  );
} else if (config.translator !== "none") {
  warn(`unknown TRANSLATOR=${config.translator}; translation disabled`);
}

const pipeline = new LinePipeline(db, { dictionary, glossary }, translator, config.targetLang);
pipeline.on("line", printLine);
pipeline.on("error", (err, msg) => warn(`could not fully process "${msg.line.slice(0, 60)}": ${err.message}`));

const server = createIngestServer({
  onConnect: (client) => info(`adapter connected (${client})`),
  onDisconnect: (client) => info(`adapter disconnected (${client})`),
  onWarning: warn,
  onMessage: (msg, client) => {
    if (msg.type === "hello") {
      console.log(
        styleText("green", `[${time()}] ${client} says hello:`),
        `${msg.adapter} ${msg.version}, game ${styleText("bold", msg.game)}`,
      );
    } else {
      void pipeline.submit(msg);
    }
  },
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${config.port} is already in use. Is another server running? Set PORT=… to change it.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  console.log(styleText("green", `Pokélearning server listening for adapters on ${config.host}:${config.port}`));
  console.log(styleText("dim", "Load adapters/mgba-lua/main.lua in mGBA (Tools → Scripting…), then talk to someone."));
});

const shutdown = () => {
  server.close();
  dictionary?.close();
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
