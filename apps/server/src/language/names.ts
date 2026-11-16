/**
 * Game names, German ↔ English, from PokéAPI's CSV data
 * (https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv): Pokémon
 * species, moves, abilities, items and places. `npm run names:import` writes
 * data/pokemon-names.json; the server turns it into glossary entries.
 */
import fs from "node:fs";
import type { GlossaryEntry } from "./glossary.ts";

export const POKEAPI_CSV = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv";
const DE = "6";
const EN = "9";

/** The PokéAPI tables the import downloads. */
export const NAME_TABLES = [
  "pokemon_species", "pokemon_species_names",
  "moves", "move_names", "type_names",
  "abilities", "ability_names",
  "items", "item_names", "item_game_indices", "item_category_prose", "item_flavor_text",
  "locations", "location_names",
] as const;
export type NameTables = Record<(typeof NAME_TABLES)[number], string>;

export interface SpeciesName {
  id: number;
  generation: number;
  de: string;
  en: string;
  genusDe: string;
  genusEn: string;
}

export interface MoveName {
  id: number;
  generation: number;
  de: string;
  en: string;
  typeDe: string;
  typeEn: string;
}

export interface AbilityName {
  id: number;
  generation: number;
  de: string;
  en: string;
}

export interface ItemName {
  id: number;
  /** Generations whose games have this item. */
  generations: number[];
  de: string;
  en: string;
  categoryDe: string;
  categoryEn: string;
  /** The English bag description in the chosen game (Emerald), if any. */
  descriptionEn: string;
}

export interface PlaceName {
  id: number;
  region: number;
  de: string;
  en: string;
}

export interface NamesFile {
  source: string;
  importedAt: string;
  species: SpeciesName[];
  moves: MoveName[];
  abilities: AbilityName[];
  items: ItemName[];
  places: PlaceName[];
}

/** Which game the names are for. Emerald: generation 3, Hoenn (region 3), version group 6. */
export interface GameScope {
  generation: number;
  regions: number[];
}

/** Minimal RFC 4180 CSV parser (quoted fields, doubled quotes, CRLF). Returns rows of objects. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.length > 1 || r[0]);
  return body.map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i] ?? ""])));
}

/** Name rows → Map<id, { de, en }> rows for the two languages. */
function byLanguage(rows: Record<string, string>[], idColumn: string, langColumn = "local_language_id") {
  const out = new Map<string, { de?: Record<string, string>; en?: Record<string, string> }>();
  for (const r of rows) {
    const lang = r[langColumn] === DE ? "de" : r[langColumn] === EN ? "en" : null;
    if (!lang) continue;
    const id = r[idColumn]!;
    const entry = out.get(id) ?? {};
    entry[lang] = r;
    out.set(id, entry);
  }
  return out;
}

/** Flavor text is wrapped for the game's text box: "Restores the HP of\na POKéMON by 20 points." */
const unwrap = (s: string) => s.replace(/\s+/g, " ").trim();

const byId = <T extends { id: number }>(list: T[]) => list.sort((a, b) => a.id - b.id);

/** Combine the PokéAPI tables. `versionGroup` picks the item descriptions (Emerald: 6). */
export function buildNames(csv: NameTables, versionGroup = 6): Omit<NamesFile, "source" | "importedAt"> {
  const speciesGen = new Map(parseCsv(csv.pokemon_species).map((r) => [r.id!, Number(r.generation_id)]));
  const species: SpeciesName[] = [];
  for (const [id, n] of byLanguage(parseCsv(csv.pokemon_species_names), "pokemon_species_id")) {
    if (!n.de?.name || !n.en?.name) continue;
    species.push({
      id: Number(id),
      generation: speciesGen.get(id) ?? 0,
      de: n.de.name,
      en: n.en.name,
      genusDe: n.de.genus ?? "",
      genusEn: n.en.genus ?? "",
    });
  }

  const types = byLanguage(parseCsv(csv.type_names), "type_id");
  const moveInfo = new Map(parseCsv(csv.moves).map((r) => [r.id!, r]));
  const moves: MoveName[] = [];
  for (const [id, n] of byLanguage(parseCsv(csv.move_names), "move_id")) {
    const info = moveInfo.get(id);
    if (!n.de?.name || !n.en?.name || !info) continue;
    const type = types.get(info.type_id!);
    moves.push({
      id: Number(id),
      generation: Number(info.generation_id),
      de: n.de.name,
      en: n.en.name,
      typeDe: type?.de?.name ?? "",
      typeEn: type?.en?.name ?? "",
    });
  }

  const abilityGen = new Map(parseCsv(csv.abilities).map((r) => [r.id!, Number(r.generation_id)]));
  const abilities: AbilityName[] = [];
  for (const [id, n] of byLanguage(parseCsv(csv.ability_names), "ability_id")) {
    if (!n.de?.name || !n.en?.name) continue;
    abilities.push({ id: Number(id), generation: abilityGen.get(id) ?? 0, de: n.de.name, en: n.en.name });
  }

  const itemInfo = new Map(parseCsv(csv.items).map((r) => [r.id!, r]));
  const itemGens = new Map<string, number[]>();
  for (const r of parseCsv(csv.item_game_indices)) {
    const list = itemGens.get(r.item_id!) ?? [];
    list.push(Number(r.generation_id));
    itemGens.set(r.item_id!, list);
  }
  const categories = byLanguage(parseCsv(csv.item_category_prose), "item_category_id");
  const descriptions = new Map<string, string>();
  for (const r of parseCsv(csv.item_flavor_text)) {
    if (r.version_group_id === String(versionGroup) && r.language_id === EN) {
      descriptions.set(r.item_id!, unwrap(r.flavor_text ?? ""));
    }
  }
  const items: ItemName[] = [];
  for (const [id, n] of byLanguage(parseCsv(csv.item_names), "item_id")) {
    const info = itemInfo.get(id);
    if (!n.de?.name || !n.en?.name || !info) continue;
    const category = categories.get(info.category_id!);
    items.push({
      id: Number(id),
      generations: [...new Set(itemGens.get(id) ?? [])].sort((a, b) => a - b),
      de: n.de.name,
      en: n.en.name,
      categoryDe: category?.de?.name ?? "",
      categoryEn: category?.en?.name ?? "",
      descriptionEn: descriptions.get(id) ?? "",
    });
  }

  const region = new Map(parseCsv(csv.locations).map((r) => [r.id!, Number(r.region_id) || 0]));
  const places: PlaceName[] = [];
  for (const [id, n] of byLanguage(parseCsv(csv.location_names), "location_id")) {
    if (!n.de?.name || !n.en?.name) continue;
    places.push({ id: Number(id), region: region.get(id) ?? 0, de: n.de.name, en: n.en.name });
  }

  return {
    species: byId(species),
    moves: byId(moves),
    abilities: byId(abilities),
    items: byId(items),
    places: byId(places),
  };
}

const REGION_NAMES: Record<number, string> = { 1: "Kanto", 2: "Johto", 3: "Hoenn", 4: "Sinnoh", 5: "Unova" };

/**
 * Glossary entries for the names in a game. They only take over words written
 * in Gen 3 capitals ("GLUT", the move Ember); in normal text "Glut" keeps its
 * dictionary meaning (embers) with the move as an alternative. Later lists win
 * when two names are spelled the same.
 */
export function nameEntries(names: Partial<Omit<NamesFile, "source" | "importedAt">>, scope: GameScope): GlossaryEntry[] {
  const entries: GlossaryEntry[] = [];
  const add = (de: string, pos: string, glosses: string[], en: string) =>
    entries.push({ match: [de], lemma: de, pos, glosses: glosses.filter(Boolean), mt: en, capsOnly: true });

  for (const s of names.species ?? []) {
    if (s.generation > scope.generation) continue;
    add(s.de, "pokemon", [s.en, `No. ${s.id}, the ${s.genusDe}${s.genusEn ? ` (${s.genusEn})` : ""}`], s.en);
  }
  for (const m of names.moves ?? []) {
    if (m.generation > scope.generation) continue;
    add(m.de, "move", [m.en, m.typeEn ? `${m.typeEn}-type move (Typ ${m.typeDe})` : "move"], m.en);
  }
  for (const a of names.abilities ?? []) {
    if (a.generation > scope.generation) continue;
    add(a.de, "ability", [a.en, "Pokémon ability (Fähigkeit)"], a.en);
  }
  for (const i of names.items ?? []) {
    if (!i.generations.includes(scope.generation)) continue;
    const category = i.categoryEn ? `${i.categoryEn} item${i.categoryDe ? ` (${i.categoryDe})` : ""}` : "item";
    add(i.de, "item", [i.en, category, i.descriptionEn], i.en);
  }
  for (const p of names.places ?? []) {
    if (!scope.regions.includes(p.region)) continue;
    add(p.de, "place", [p.en, `Place in ${REGION_NAMES[p.region] ?? "the game"}`], p.en);
  }
  return entries;
}

export function loadNames(file: string): NamesFile | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as NamesFile;
}
