/**
 * Pokélearning server.
 *
 * adapter (TCP, NDJSON) → ingest → pipeline (store, analyse, translate) → terminal + web UI (WebSocket)
 */
import os from "node:os";
import { styleText } from "node:util";
import type { ServerStatus } from "@pokelearning/shared";
import { config } from "./config.ts";
import { AppDb } from "./db/app-db.ts";
import { openDictionary } from "./dictionary/db.ts";
import { createIngestServer } from "./ingest/tcp.ts";
import { defaultGlossaryFile, loadGlossary } from "./language/glossary.ts";
import { LinePipeline } from "./pipeline.ts";
import { printLine, time } from "./print.ts";
import { OpusMtProvider } from "./translate/opus-mt.ts";
import { Translator } from "./translate/translator.ts";
import { createUiServer } from "./ui/server.ts";
import { Scheduler } from "./wordbank/scheduler.ts";
import { WordBank } from "./wordbank/wordbank.ts";

const info = (text: string) => console.log(styleText("cyan", `[${time()}] ${text}`));
const warn = (text: string) => console.warn(styleText("yellow", `[${time()}] ${text}`));

const db = new AppDb(config.appDbPath);
const glossary = loadGlossary(defaultGlossaryFile);
const dictionary = openDictionary(config.dictionaryDbPath);
if (dictionary) info(`dictionary ${dictionary.version}`);
else warn("no dictionary found: run `npm run dict:import` for the word-by-word breakdown");

const status: ServerStatus = { adapters: 0, game: null, translator: null, dictionary: dictionary?.version ?? null };

let translator: Translator | null = null;
if (config.translator === "opus-mt") {
  translator = new Translator(new OpusMtProvider(config.modelsDir, "de", config.targetLang), db, glossary);
  const started = Date.now();
  info(`loading translation model ${translator.providerId} (first run downloads ~110 MB)…`);
  translator.warmUp().then(
    () => {
      info(`translation model ready (${((Date.now() - started) / 1000).toFixed(1)} s)`);
      status.translator = translator!.providerId;
      ui.broadcastStatus();
    },
    (err: Error) => warn(`translation model failed to load: ${err.message}. Lines will be shown untranslated.`),
  );
} else if (config.translator !== "none") {
  warn(`unknown TRANSLATOR=${config.translator}; translation disabled`);
}

const wordbank = new WordBank(db, new Scheduler());
const ui = createUiServer({ db, wordbank, status: () => ({ ...status }), staticDir: config.webDistDir });

const pipeline = new LinePipeline(db, { dictionary, glossary }, translator, config.targetLang);
pipeline.on("line", printLine);
pipeline.on("line", ui.broadcastLine);
pipeline.on("line", (line) => {
  // a saved word came up again: new encounter, maybe a new example sentence
  if (wordbank.recordLine(line)) ui.broadcastWordBank();
});
pipeline.on("error", (err, msg) => warn(`could not fully process "${msg.line.slice(0, 60)}": ${err.message}`));

const ingest = createIngestServer({
  onConnect: (client) => {
    info(`adapter connected (${client})`);
    status.adapters++;
    ui.broadcastStatus();
  },
  onDisconnect: (client) => {
    info(`adapter disconnected (${client})`);
    status.adapters = Math.max(0, status.adapters - 1);
    ui.broadcastStatus();
  },
  onWarning: warn,
  onMessage: (msg, client) => {
    if (msg.type === "hello") {
      console.log(
        styleText("green", `[${time()}] ${client} says hello:`),
        `${msg.adapter} ${msg.version}, game ${styleText("bold", msg.game)}`,
      );
      status.game = msg.game;
      ui.broadcastStatus();
    } else {
      void pipeline.submit(msg);
    }
  },
});

const exitOnListenError = (port: number, envVar: string) => (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Is another server running? Set ${envVar}=… to change it.`);
  } else {
    console.error(err);
  }
  process.exit(1);
};
ingest.on("error", exitOnListenError(config.port, "PORT"));
ui.http.on("error", exitOnListenError(config.uiPort, "UI_PORT"));

/** Addresses a phone on the same network can use. */
function lanUrls(port: number): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => `http://${i!.address}:${port}`);
}

ingest.listen(config.port, config.host, () => {
  console.log(styleText("green", `Pokélearning server listening for adapters on ${config.host}:${config.port}`));
  console.log(styleText("dim", "Load adapters/mgba-lua/main.lua in mGBA (Tools → Scripting…), then talk to someone."));
});
ui.http.listen(config.uiPort, config.uiHost, () => {
  const open = config.uiHost === "0.0.0.0" ? lanUrls(config.uiPort) : [];
  console.log(styleText("green", `Web UI: http://localhost:${config.uiPort}`) + (open.length ? ` (phone: ${open.join(", ")})` : ""));
  if (!open.length) console.log(styleText("dim", "To use it on your phone, start with UI_HOST=0.0.0.0."));
});

const shutdown = () => {
  ingest.close();
  ui.close();
  dictionary?.close();
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
