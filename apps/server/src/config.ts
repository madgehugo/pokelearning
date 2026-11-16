import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROTOCOL_PORT } from "@pokelearning/shared";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(repoRoot, "data"));

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? PROTOCOL_PORT),
  dataDir,
  /** Your data: received lines, analyses, translation cache (later: word bank). */
  appDbPath: path.join(dataDir, "app.db"),
  /** Rebuildable: `npm run dict:import`. */
  dictionaryDbPath: path.join(dataDir, "dictionary.db"),
  kaikkiPath: path.join(dataDir, "kaikki-german.jsonl.gz"),
  kaikkiUrl: "https://kaikki.org/dictionary/German/kaikki.org-dictionary-German.jsonl.gz",
  modelsDir: path.join(dataDir, "models"),
  /** "opus-mt" (local, default) or "none". */
  translator: process.env.TRANSLATOR ?? "opus-mt",
  targetLang: "en",
};
