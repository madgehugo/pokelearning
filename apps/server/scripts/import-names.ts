/**
 * Download Pokémon species and move names (German ↔ English) from PokéAPI and
 * write data/pokemon-names.json. Run again to pick up PokéAPI updates.
 *
 *   npm run names:import
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../src/config.ts";
import { buildNames, POKEAPI_CSV, type NamesFile } from "../src/language/names.ts";

const TABLES = ["pokemon_species", "pokemon_species_names", "moves", "move_names", "type_names"] as const;

async function main() {
  const csv = {} as Record<(typeof TABLES)[number], string>;
  for (const table of TABLES) {
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
  const gen = (list: { generation: number }[]) => list.filter((x) => x.generation <= config.namesMaxGeneration).length;
  console.log(
    `wrote ${path.relative(process.cwd(), config.namesPath)}: ${names.species.length} species, ${names.moves.length} moves ` +
      `(${gen(names.species)} and ${gen(names.moves)} up to generation ${config.namesMaxGeneration} are used)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
