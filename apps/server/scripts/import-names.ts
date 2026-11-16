/**
 * Download game names (German ↔ English) from PokéAPI: Pokémon species,
 * moves, abilities, items and places. Writes data/pokemon-names.json. Run
 * again to pick up PokéAPI updates, then `npm run reprocess`.
 *
 *   npm run names:import
 */
import path from "node:path";
import { config } from "../src/config.ts";
import { nameEntries } from "../src/language/names.ts";
import { importNames } from "../src/setup/names.ts";

importNames(config.namesPath, (_, detail) => process.stdout.write(`\r${detail.padEnd(60)}`)).then(
  (names) => {
    const used = nameEntries(names, config.namesScope);
    const count = (pos: string) => used.filter((e) => e.pos === pos).length;
    console.log(
      `\nwrote ${path.relative(process.cwd(), config.namesPath)}. For generation ${config.namesScope.generation}: ` +
        `${count("pokemon")} Pokémon, ${count("move")} moves, ${count("ability")} abilities, ` +
        `${count("item")} items, ${count("place")} places`,
    );
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
