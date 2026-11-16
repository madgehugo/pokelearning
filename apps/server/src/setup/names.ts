/** Download game names (German ↔ English) from PokéAPI and write data/pokemon-names.json. */
import fs from "node:fs";
import path from "node:path";
import { buildNames, NAME_TABLES, POKEAPI_CSV, type NamesFile, type NameTables } from "../language/names.ts";
import type { Progress } from "./download.ts";

export async function importNames(namesPath: string, onProgress: Progress): Promise<NamesFile> {
  const csv = {} as NameTables;
  for (const [i, table] of NAME_TABLES.entries()) {
    onProgress(i / NAME_TABLES.length, `Downloading game names (${i + 1} of ${NAME_TABLES.length})`);
    const url = `${POKEAPI_CSV}/${table}.csv`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`couldn't download game names (${table}: HTTP ${res.status})`);
    csv[table] = await res.text();
  }
  const names: NamesFile = { source: POKEAPI_CSV, importedAt: new Date().toISOString(), ...buildNames(csv) };
  fs.mkdirSync(path.dirname(namesPath), { recursive: true });
  fs.writeFileSync(`${namesPath}.part`, JSON.stringify(names));
  fs.renameSync(`${namesPath}.part`, namesPath);
  onProgress(1, "Game names ready");
  return names;
}
