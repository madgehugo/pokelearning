/**
 * Build data/dictionary.db from the Kaikki.org German extract of English
 * Wiktionary (CC BY-SA). Downloads the extract (~100 MB) if it isn't there.
 */
import fs from "node:fs";
import readline from "node:readline";
import { createGunzip } from "node:zlib";
import { DictionaryBuilder } from "../dictionary/db.ts";
import { convertEntry, type KaikkiEntry } from "../dictionary/kaikki.ts";
import { download, type Progress } from "./download.ts";

export interface DictionaryPaths {
  dataDir: string;
  kaikkiPath: string;
  kaikkiUrl: string;
  dictionaryDbPath: string;
}

export interface DictionaryResult {
  version: string;
  lexemes: number;
  forms: number;
}

export interface DictionaryOptions {
  /** Download the extract again even if it's there. */
  fresh?: boolean;
  /** Delete the ~100 MB extract after building (the app does; developers keep it to rebuild). */
  deleteDownload?: boolean;
}

export async function importDictionary(paths: DictionaryPaths, onProgress: Progress, options: DictionaryOptions = {}): Promise<DictionaryResult> {
  const { fresh = false, deleteDownload = false } = options;
  fs.mkdirSync(paths.dataDir, { recursive: true });
  if (fresh || !fs.existsSync(paths.kaikkiPath)) {
    // downloading is the first ~60% of the work, building the rest
    await download(paths.kaikkiUrl, paths.kaikkiPath, (f, d) => onProgress(f === null ? null : f * 0.6, d), "the dictionary");
  }

  const tmp = `${paths.dictionaryDbPath}.building`;
  fs.rmSync(tmp, { force: true });
  const builder = new DictionaryBuilder(tmp);
  const size = fs.statSync(paths.kaikkiPath).size;
  let read = 0;
  const file = fs.createReadStream(paths.kaikkiPath);
  file.on("data", (chunk) => (read += chunk.length));
  const lines = readline.createInterface({ input: file.pipe(createGunzip()), crlfDelay: Infinity });
  let entries = 0;
  for await (const line of lines) {
    if (!line) continue;
    builder.add(convertEntry(JSON.parse(line) as KaikkiEntry));
    if (++entries % 10_000 === 0) onProgress(0.6 + 0.35 * (read / size), `Building the dictionary: ${entries.toLocaleString("en")} entries`);
  }

  onProgress(0.97, "Building the dictionary: indexing words");
  const version = `kaikki-de@${fs.statSync(paths.kaikkiPath).mtime.toISOString().slice(0, 10)}`;
  const counts = builder.finish(version);
  fs.renameSync(tmp, paths.dictionaryDbPath);
  if (deleteDownload) fs.rmSync(paths.kaikkiPath, { force: true });
  onProgress(1, `${counts.lexemes.toLocaleString("en")} words`);
  return { version, ...counts };
}
