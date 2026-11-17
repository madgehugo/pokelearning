/**
 * Pokélearning server.
 *
 * adapter (TCP, NDJSON) → ingest → pipeline (store, analyse, translate) → terminal + web UI (WebSocket)
 */
import os from "node:os";
import { styleText } from "node:util";
import { adapterVersionProblem, type ServerStatus } from "@pokelearning/shared";
import { config } from "./config.ts";
import { AppDb } from "./db/app-db.ts";
import { openDictionary } from "./dictionary/db.ts";
import { createIngestServer } from "./ingest/tcp.ts";
import { languageOf, loadGameGlossaries } from "./language/load.ts";
import { loadNames } from "./language/names.ts";
import { LinePipeline } from "./pipeline.ts";
import { printLine, time } from "./print.ts";
import { OpusMtProvider } from "./translate/opus-mt.ts";
import { Translator, TranslatorSet } from "./translate/translator.ts";
import { Games } from "./games/games.ts";
import { createUiServer } from "./ui/server.ts";
import { Scheduler } from "./wordbank/scheduler.ts";
import { WordBank } from "./wordbank/wordbank.ts";
import { checkForUpdate } from "./update.ts";
import { Setup } from "./setup/setup.ts";
import { importDictionary } from "./setup/dictionary.ts";
import { importNames } from "./setup/names.ts";
import fs from "node:fs";

const info = (text: string) => console.log(styleText("cyan", `[${time()}] ${text}`));
const warn = (text: string) => console.warn(styleText("yellow", `[${time()}] ${text}`));

const db = new AppDb(config.appDbPath);

/** Dictionary and glossaries, reloaded when setup finishes importing them. */
const language = {
  dictionary: openDictionary(config.dictionaryDbPath),
  /** Spanish, for Spanish games: built with `npm run dict:import -- es`. */
  dictionaryEs: openDictionary(config.languages.es.dictionaryDbPath),
  glossaries: loadGameGlossaries(),
};
const names = language.glossaries.nameCount("pokemon-emerald-de");
if (names !== null) info(`game names: ${names} Pokémon, moves, abilities, items and places (Emerald; other games get their own)`);
else warn("no game names found: run `npm run names:import` (the app's first-launch setup does this)");
if (language.dictionary) info(`dictionary ${language.dictionary.version}`);
else warn("no dictionary found: run `npm run dict:import` (the app's first-launch setup does this)");
if (language.dictionaryEs) info(`Spanish dictionary ${language.dictionaryEs.version}`);

const status: ServerStatus = { adapters: 0, game: null, adapterWarning: null, translator: null, dictionary: language.dictionary?.version ?? null, update: null };

let translator: Translator | null = null;
/** Spanish translator, loaded when a Spanish game connects. */
let translatorEs: Translator | null = null;
if (config.translator === "opus-mt") {
  translator = new Translator(
    new OpusMtProvider(config.modelsDir, "de", config.targetLang),
    db,
    language.glossaries.forGame("pokemon-emerald-de"),
  );
  translatorEs = new Translator(
    new OpusMtProvider(config.modelsDir, "es", config.targetLang),
    db,
    language.glossaries.forGame("pokemon-emerald-es"),
  );
  info(`loading translation model ${translator.providerId} (first run downloads ~110 MB)…`);
  void warmUpModel();
} else if (config.translator !== "none") {
  warn(`unknown TRANSLATOR=${config.translator}; translation disabled`);
}

/**
 * Load the translation model; called at start and again by setup after a failure.
 * (It only touches `ui` after awaiting, so after `ui` below exists.)
 */
async function warmUpModel(): Promise<void> {
  if (!translator) return;
  const started = Date.now();
  try {
    await translator.warmUp();
    info(`translation model ready (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    status.translator = translator.providerId;
    ui.broadcastStatus();
  } catch (err) {
    warn(`translation model failed to load: ${(err as Error).message}. Lines will be shown untranslated.`);
    throw err;
  }
}

/** Names files imported before Spanish support lack the Spanish names. */
function namesIncludeSpanish(): boolean {
  const names = loadNames(config.namesPath);
  return names?.species[0]?.es !== undefined;
}

const setup = new Setup({
  namesReady: () => fs.existsSync(config.namesPath),
  dictionaryReady: () => language.dictionary !== null,
  importNames: (p) => importNames(config.namesPath, p),
  // Setup only builds a missing dictionary (the app's first launch), and nothing there
  // rebuilds it, so the ~100 MB raw download can go. `npm run dict:import` keeps it.
  importDictionary: (p) => importDictionary(config, p, { deleteDownload: true }),
  model: translator && { status: () => translator!.status(), warmUp: warmUpModel },
  spanish: {
    namesReady: () => namesIncludeSpanish(),
    dictionaryReady: () => language.dictionaryEs !== null,
    importDictionary: (p) => importDictionary(config.languages.es, p, { deleteDownload: true }),
    model: translatorEs && { status: () => translatorEs!.status(), warmUp: () => translatorEs!.warmUp() },
  },
  onImported: (step) => {
    if (step === "dictionary-es") {
      language.dictionaryEs?.close();
      language.dictionaryEs = openDictionary(config.languages.es.dictionaryDbPath);
      info(`Spanish dictionary ${language.dictionaryEs?.version ?? "?"} loaded`);
    } else if (step === "dictionary") {
      language.dictionary?.close();
      language.dictionary = openDictionary(config.dictionaryDbPath);
      status.dictionary = language.dictionary?.version ?? null;
      info(`dictionary ${status.dictionary} loaded`);
    } else {
      language.glossaries = loadGameGlossaries();
      info("game names loaded");
    }
    ui.broadcastStatus();
  },
  onChange: () => ui.broadcastSetup(),
});

if (language.dictionaryEs) setup.requireSpanish(); // Spanish was set up before: keep it ready

const wordbank = new WordBank(db, new Scheduler());
const games = new Games(db, wordbank);
const ui = createUiServer({ db, wordbank, games, setup, status: () => ({ ...status }), staticDir: config.webDistDir });

const pipeline = new LinePipeline(
  db,
  (game, lang) => ({
    lang,
    dictionary: lang === "es" ? language.dictionaryEs : language.dictionary,
    glossary: language.glossaries.forGame(game),
  }),
  translator && new TranslatorSet(new Map([["de", translator], ...(translatorEs ? [["es", translatorEs] as const] : [])])),
  config.targetLang,
);
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
    if (status.adapters === 0) status.adapterWarning = null;
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
      if (languageOf(msg.game) === "es") {
        setup.requireSpanish();
        void setup.start();
      }
      status.adapterWarning = adapterVersionProblem(msg);
      if (status.adapterWarning) warn(status.adapterWarning);
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

/** Look for a newer release now and then daily; the server runs as long as the app does. */
if (config.updateCheck) {
  const look = async () => {
    const update = await checkForUpdate(config.version, config.repo);
    if (JSON.stringify(update) === JSON.stringify(status.update)) return;
    status.update = update;
    if (update) info(`version ${update.version} is available: ${update.url}`);
    ui.broadcastStatus();
  };
  void look();
  setInterval(() => void look(), 24 * 60 * 60 * 1000).unref();
}

const shutdown = () => {
  ingest.close();
  ui.close();
  language.dictionary?.close();
  language.dictionaryEs?.close();
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
