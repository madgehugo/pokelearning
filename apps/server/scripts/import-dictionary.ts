/**
 * Build data/dictionary.db from the Kaikki.org German extract of English
 * Wiktionary (CC BY-SA). Downloads the extract (~100 MB) on first run.
 *
 *   npm run dict:import            build (download if needed)
 *   npm run dict:import -- --fresh re-download the extract first
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { config } from "../src/config.ts";
import { DictionaryBuilder } from "../src/dictionary/db.ts";
import { convertEntry, type KaikkiEntry } from "../src/dictionary/kaikki.ts";

async function download(url: string, dest: string): Promise<void> {
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  let received = 0;
  let lastReport = 0;
  const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  body.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (total && received - lastReport > total / 20) {
      lastReport = received;
      process.stdout.write(`  ${Math.round((received / total) * 100)}%\r`);
    }
  });
  await pipeline(body, fs.createWriteStream(`${dest}.part`));
  fs.renameSync(`${dest}.part`, dest);
  console.log("  done");
}

async function main() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (process.argv.includes("--fresh") || !fs.existsSync(config.kaikkiPath)) {
    await download(config.kaikkiUrl, config.kaikkiPath);
  }

  const tmp = `${config.dictionaryDbPath}.building`;
  fs.rmSync(tmp, { force: true });
  const builder = new DictionaryBuilder(tmp);

  const started = Date.now();
  const lines = readline.createInterface({
    input: fs.createReadStream(config.kaikkiPath).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  let entries = 0;
  for await (const line of lines) {
    if (!line) continue;
    builder.add(convertEntry(JSON.parse(line) as KaikkiEntry));
    if (++entries % 50_000 === 0) console.log(`  ${entries} entries…`);
  }

  const version = `kaikki-de@${fs.statSync(config.kaikkiPath).mtime.toISOString().slice(0, 10)}`;
  console.log("resolving forms and building indexes…");
  const counts = builder.finish(version);
  fs.renameSync(tmp, config.dictionaryDbPath);
  const mb = (fs.statSync(config.dictionaryDbPath).size / 1e6).toFixed(0);
  console.log(
    `built ${path.relative(process.cwd(), config.dictionaryDbPath)} (${version}): ` +
      `${counts.lexemes} lexemes, ${counts.forms} forms, ${mb} MB in ${((Date.now() - started) / 1000).toFixed(0)} s`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
