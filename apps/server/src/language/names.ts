/**
 * Pokémon species and move names, German ↔ English, from PokéAPI's CSV data
 * (https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv).
 * `npm run names:import` writes data/pokemon-names.json; the server turns it
 * into glossary entries.
 */
import fs from "node:fs";
import type { GlossaryEntry } from "./glossary.ts";

export const POKEAPI_CSV = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv";
const DE = "6";
const EN = "9";

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

export interface NamesFile {
  source: string;
  importedAt: string;
  species: SpeciesName[];
  moves: MoveName[];
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

/** name rows → Map<id, { de, en, … }> for the two languages. */
function byLanguage(rows: Record<string, string>[], idColumn: string) {
  const out = new Map<string, { de?: Record<string, string>; en?: Record<string, string> }>();
  for (const r of rows) {
    const lang = r.local_language_id === DE ? "de" : r.local_language_id === EN ? "en" : null;
    if (!lang) continue;
    const id = r[idColumn]!;
    const entry = out.get(id) ?? {};
    entry[lang] = r;
    out.set(id, entry);
  }
  return out;
}

/** Combine the PokéAPI tables into species and move lists. */
export function buildNames(csv: {
  pokemon_species: string;
  pokemon_species_names: string;
  moves: string;
  move_names: string;
  type_names: string;
}): Omit<NamesFile, "source" | "importedAt"> {
  const generation = new Map(parseCsv(csv.pokemon_species).map((r) => [r.id!, Number(r.generation_id)]));
  const types = byLanguage(parseCsv(csv.type_names), "type_id");
  const species: SpeciesName[] = [];
  for (const [id, n] of byLanguage(parseCsv(csv.pokemon_species_names), "pokemon_species_id")) {
    if (!n.de?.name || !n.en?.name) continue;
    species.push({
      id: Number(id),
      generation: generation.get(id) ?? 0,
      de: n.de.name,
      en: n.en.name,
      genusDe: n.de.genus ?? "",
      genusEn: n.en.genus ?? "",
    });
  }
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
  species.sort((a, b) => a.id - b.id);
  moves.sort((a, b) => a.id - b.id);
  return { species, moves };
}

/**
 * Glossary entries for species and moves up to `maxGeneration`. They only take
 * over a word written in Gen 3 capitals ("GLUT", the move Ember); in normal
 * text "Glut" keeps its dictionary meaning (embers) with the move as an alternative.
 */
export function nameEntries(names: Pick<NamesFile, "species" | "moves">, maxGeneration: number): GlossaryEntry[] {
  const entries: GlossaryEntry[] = [];
  for (const s of names.species) {
    if (s.generation > maxGeneration) continue;
    entries.push({
      match: [s.de],
      lemma: s.de,
      pos: "pokemon",
      glosses: [s.en, `No. ${s.id}, the ${s.genusDe}${s.genusEn ? ` (${s.genusEn})` : ""}`],
      mt: s.en,
      capsOnly: true,
    });
  }
  for (const m of names.moves) {
    if (m.generation > maxGeneration) continue;
    entries.push({
      match: [m.de],
      lemma: m.de,
      pos: "move",
      glosses: [m.en, m.typeEn ? `${m.typeEn}-type move (Typ ${m.typeDe})` : "move"],
      mt: m.en,
      capsOnly: true,
    });
  }
  return entries;
}

export function loadNames(file: string): NamesFile | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as NamesFile;
}
