/**
 * Download game names (German ↔ English) from PokéAPI: Pokémon species,
 * moves, abilities, items and places. Writes data/pokemon-names.json. Run
 * again to pick up PokéAPI updates, then `npm run reprocess`.
 *
 *   npm run names:import
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../src/config.ts";
import { buildNames, NAME_TABLES, nameEntries, POKEAPI_CSV, type NamesFile, type NameTables } from "../src/language/names.ts";

async function main() {
  const csv = {} as NameTables;
  for (const table of NAME_TABLES) {
    const url = `${POKEAPI_CSV}/${table}.csv`;
    process.stdout.write(`downloading ${table}.csv… `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    csv[table] = await res.text();
    console.log(`${(csv[table].length / 1024).toFixed(0)} KB`);
  }
  const names: NamesFile = { source: POKEAPI_CSV, importedAt: new Date().toISOString(), ...buildNames(csv) };
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(config.namesPath, JSON.stringify(names));
  const used = nameEntries(names, config.namesScope);
  const count = (pos: string) => used.filter((e) => e.pos === pos).length;
  console.log(
    `wrote ${path.relative(process.cwd(), config.namesPath)}. For generation ${config.namesScope.generation}: ` +
      `${count("pokemon")} Pokémon, ${count("move")} moves, ${count("ability")} abilities, ` +
      `${count("item")} items, ${count("place")} places`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
