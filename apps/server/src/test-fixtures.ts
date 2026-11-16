/** Small Kaikki-format entries for tests, modelled on the real data. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DictionaryBuilder, openDictionary, type Dictionary } from "./dictionary/db.ts";
import { convertEntry, type KaikkiEntry } from "./dictionary/kaikki.ts";

export const ENTRIES: KaikkiEntry[] = [
  {
    word: "Haus", pos: "noun",
    head_templates: [{ args: { "1": "n,es,^er" } }],
    senses: [{ glosses: ["house, building"], tags: ["neuter", "strong"] }],
    forms: [
      { form: "Hauses", tags: ["genitive"] },
      { form: "Häuser", tags: ["plural"] },
      { form: "Häuschen", tags: ["diminutive", "neuter"] },
      { form: "de-ndecl", tags: ["inflection-template"] },
    ],
  },
  {
    word: "Häusern", pos: "noun",
    senses: [{ glosses: ["dative plural of Haus"], tags: ["dative", "form-of", "plural"], form_of: [{ word: "Haus" }] }],
  },
  {
    word: "sein", pos: "verb",
    head_templates: [{ args: { "1": "sein<war,gewesen.sein>" } }],
    senses: [
      { glosses: ["forms the present perfect of certain verbs"], tags: ["auxiliary"] },
      { glosses: ["to be"] },
    ],
    forms: [{ form: "bin", tags: ["first-person", "present", "singular"] }],
  },
  {
    word: "bin", pos: "verb",
    senses: [{ glosses: ["first-person singular present of sein"], tags: ["first-person", "form-of", "present", "singular"], form_of: [{ word: "sein" }] }],
  },
  {
    word: "ausruhen", pos: "verb",
    head_templates: [{ args: { "1": "aus.ruhen" } }],
    senses: [{ glosses: ["to rest"], tags: ["reflexive", "weak"] }],
    forms: [
      { form: "ruhe aus", tags: ["first-person", "present", "singular"] },
      { form: "ruh aus", tags: ["imperative", "singular"] },
      { form: "ausgeruht", tags: ["participle", "past"] },
      { form: "hat ausgeruht", tags: ["perfect"] },
    ],
  },
  {
    word: "ruhen", pos: "verb",
    senses: [{ glosses: ["to rest; to sleep"], tags: ["intransitive"] }, { glosses: ["to be idle"] }],
    forms: [
      { form: "ruhe", tags: ["first-person", "present", "singular"] },
      { form: "ruh", tags: ["imperative", "singular"] },
    ],
  },
  { word: "Ruhe", pos: "noun", senses: [{ glosses: ["calm, quiet"], tags: ["feminine"] }] },
  { word: "aus", pos: "prep", senses: [{ glosses: ["out of, from"] }] },
  {
    word: "warten", pos: "verb",
    senses: [{ glosses: ["to wait"], tags: ["intransitive"] }],
    forms: [{ form: "wartet", tags: ["present", "singular", "third-person"] }],
  },
  {
    word: "aufwarten", pos: "verb",
    head_templates: [{ args: { "1": "auf.warten" } }],
    senses: [{ glosses: ["to serve, to wait on"] }],
    forms: [{ form: "wartet auf", tags: ["present", "singular", "third-person"] }],
  },
  { word: "auf", pos: "prep", senses: [{ glosses: ["on, upon"] }] },
  { word: "Glut", pos: "noun", senses: [{ glosses: ["embers"], tags: ["feminine"] }] },
  { word: "ich", pos: "pron", senses: [{ glosses: ["I"] }] },
  { word: "Ich", pos: "noun", senses: [{ glosses: ["ego"], tags: ["neuter"] }] },
  { word: "dich", pos: "pron", senses: [{ glosses: ["accusative of du"], tags: ["accusative", "form-of"], form_of: [{ word: "du" }] }] },
  { word: "du", pos: "pron", senses: [{ glosses: ["you (singular)"] }] },
  {
    word: "er", pos: "pron",
    senses: [{ glosses: ["he"] }, { glosses: ["it"] }],
    forms: [{ form: "dich", tags: ["accusative", "second-person"] }],
  },
  {
    word: "Dein", pos: "pron",
    senses: [{ glosses: ["alternative letter-case form of dein"], tags: ["alt-of"], alt_of: [{ word: "dein" }] }],
  },
  { word: "dein", pos: "pron", senses: [{ glosses: ["your (singular)"] }] },
  {
    word: "im", pos: "contraction",
    senses: [{ glosses: ["contraction of in + dem; in the"], tags: ["abbreviation", "alt-of", "contraction"], alt_of: [{ word: "in" }] }],
  },
  { word: "gut", pos: "adj", senses: [{ glosses: ["good"] }] },
  { word: "Center", pos: "noun", senses: [{ glosses: ["center"], tags: ["neuter"] }] },
  { word: "Pokémon", pos: "noun", senses: [{ glosses: ["Pokémon (creature)"], tags: ["neuter"] }] },
  { word: "-chen", pos: "suffix", senses: [{ glosses: ["diminutive suffix"] }] },
];

/** Build a dictionary from the fixture entries in a temp file. */
export function fixtureDictionary(entries: KaikkiEntry[] = ENTRIES): Dictionary {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pokelearning-dict-"));
  const file = path.join(dir, "dictionary.db");
  const builder = new DictionaryBuilder(file);
  for (const e of entries) builder.add(convertEntry(e));
  builder.finish("test");
  return openDictionary(file)!;
}
