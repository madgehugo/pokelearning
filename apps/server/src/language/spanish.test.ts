import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { KaikkiEntry } from "../dictionary/kaikki.ts";
import { fixtureDictionary } from "../test-fixtures.ts";
import { analyzeLine } from "./analyze.ts";
import { createGlossary, loadGlossary } from "./glossary.ts";
import { languageOf } from "./load.ts";
import { buildNames, nameEntries } from "./names.ts";

/** Spanish entries in the shape of the real Kaikki extract (checked against casa, comer, la, del). */
const ENTRIES: KaikkiEntry[] = [
  { word: "casa", pos: "noun", forms: [{ form: "casas", tags: ["plural"] }], senses: [{ glosses: ["house"], tags: ["feminine"] }] },
  { word: "pueblo", pos: "noun", senses: [{ glosses: ["town, village"], tags: ["masculine"] }] },
  { word: "centro", pos: "noun", senses: [{ glosses: ["center"], tags: ["masculine"] }] },
  { word: "joven", pos: "noun", senses: [{ glosses: ["young person"], tags: ["masculine", "feminine"] }] },
  {
    word: "comer", pos: "verb",
    forms: [{ form: "comes", tags: ["second-person", "present", "singular"] }, { form: "no-table-tags", tags: ["table-tags"] }],
    senses: [{ glosses: ["to eat"] }],
  },
  {
    word: "comió", pos: "verb",
    senses: [{ glosses: ["third-person singular preterite indicative of comer"], tags: ["form-of", "preterite"], form_of: [{ word: "comer" }] }],
  },
  { word: "del", pos: "contraction", senses: [{ glosses: ["of the, from the"], tags: ["contraction"] }] },
  { word: "al", pos: "contraction", senses: [{ glosses: ["to the"], tags: ["contraction"] }] },
  { word: "vamos", pos: "intj", senses: [{ glosses: ["let's go!"] }] },
  { word: "Pokémon", pos: "noun", senses: [{ glosses: ["Pokémon (creature)"], tags: ["masculine"] }] },
  { word: "abedul", pos: "noun", senses: [{ glosses: ["birch"], tags: ["masculine"] }] },
  { word: "padre", pos: "adj", senses: [{ glosses: ["cool"] }, { glosses: ["acceptable"] }] },
  { word: "padre", pos: "noun", senses: [{ glosses: ["father"], tags: ["masculine"] }, { glosses: ["parent"] }, { glosses: ["priest"] }] },
  { word: "no", pos: "noun", senses: [{ glosses: ["no"], tags: ["masculine"] }] },
  { word: "no", pos: "adv", senses: [{ glosses: ["not"] }] },
  { word: "mi", pos: "noun", senses: [{ glosses: ["mi (musical note)"], tags: ["masculine"] }] },
  { word: "vez", pos: "noun", forms: [{ form: "veces", tags: ["plural"] }], senses: [{ glosses: ["time, instance"], tags: ["feminine"] }] },
  { word: "veces", pos: "prep", senses: [{ glosses: ["by, times (multiplication)"] }] },
  { word: "nueva", pos: "name", senses: [{ glosses: ["a village in Asturias"] }] },
  { word: "nuevo", pos: "adj", forms: [{ form: "nueva", tags: ["feminine", "singular"] }], senses: [{ glosses: ["new"] }] },
  { word: "pueblo", pos: "verb", senses: [{ glosses: ["first-person singular present of poblar"], tags: ["form-of"], form_of: [{ word: "poblar" }] }] },
];

describe("Spanish analysis", () => {
  const dictionary = fixtureDictionary(ENTRIES);
  const glossary = createGlossary([]);
  const analyze = (line: string) => analyzeLine(line, { dictionary, glossary, lang: "es" });
  const word = (line: string, text: string) => analyze(line).tokens.find((t) => t.text === text)!;

  it("is tagged Spanish, and gives nouns el or la", () => {
    assert.equal(analyze("La casa.").lang, "es");
    assert.deepEqual(word("Vamos a la casa", "casa").best?.articles, ["la"]);
    assert.deepEqual(word("Vamos al pueblo", "pueblo").best?.articles, ["el"]);
    assert.deepEqual(word("Es joven", "joven").best?.articles, ["el", "la"]);
  });

  it("finds the lemma of an inflected verb and plural nouns", () => {
    assert.equal(word("Tú comes", "comes").best?.lemma, "comer");
    assert.equal(word("Ella comió", "comió").best?.lemma, "comer", "a form-of entry resolves too");
    assert.equal(word("Las casas", "casas").best?.lemma, "casa");
    assert.match(word("Las casas", "casas").best?.formTags ?? "", /plural/);
  });

  it("doesn't apply German rules: a lowercase noun is still a noun, nothing is split", () => {
    assert.equal(word("Voy al centro del pueblo", "centro").best?.pos, "noun");
    assert.equal(word("Voy al centro del pueblo", "del").best?.pos, "contraction");
    // German would split this compound; Spanish leaves an unknown word unknown
    assert.equal(word("Un casapueblo", "casapueblo").best, undefined);
  });

  it("treats ¿ and ¡ as the start of a sentence", () => {
    assert.equal(word("¿Comer?", "Comer").best?.lemma, "comer");
  });

  it("takes a name in capitals as the dictionary word", () => {
    assert.equal(word("Me llamo ABEDUL.", "ABEDUL").best?.lemma, "abedul");
  });
});

describe("Spanish ranking", () => {
  const dictionary = fixtureDictionary(ENTRIES);
  const glossary = loadGlossary([], "es");
  const analyze = (line: string) => analyzeLine(line, { dictionary, glossary, lang: "es" });
  const word = (line: string, text: string) => analyze(line).tokens.find((t) => t.text === text)!;

  it("reads a noun, not an adjective or verb, after an article or possessive", () => {
    assert.equal(word("Ve a tu padre", "padre").best?.pos, "noun");
    assert.equal(word("El pueblo", "pueblo").best?.pos, "noun");
    assert.equal(word("Veo el pueblo", "pueblo").best?.articles?.[0], "el");
  });

  it("prefers a function word to its rare noun reading, in capitals too", () => {
    assert.equal(word("NO APAGUES", "NO").best?.pos, "adv");
    assert.equal(word("No", "No").best?.pos, "adv");
  });

  it("doesn't take a village for an all-caps adjective", () => {
    assert.notEqual(word("PARTIDA NUEVA", "NUEVA").best?.pos, "name");
  });

  it("knows the words the dictionary gets wrong: tu, mi, veces, lo, sí", () => {
    assert.equal(word("tu edad", "tu").best?.lemma, "tu");
    assert.equal(word("Mi vida", "Mi").best?.pos, "det");
    const veces = word("A veces", "veces").best;
    assert.equal(veces?.lemma, "vez");
    assert.deepEqual(veces?.articles, ["la"]);
    assert.equal(word("te lo dé", "lo").best?.pos, "pron");
    assert.equal(word("Sí", "Sí").best?.pos, "particle");
  });
});

describe("game language", () => {
  it("is read from the game id", () => {
    assert.equal(languageOf("pokemon-emerald-es"), "es");
    assert.equal(languageOf("pokemon-emerald-de"), "de");
    assert.equal(languageOf("something-else"), "de");
  });

  it("gives Spanish games Spanish names and none of the German game terms", () => {
    const csv = {
      pokemon_species: "id,generation_id\n263,3\n",
      pokemon_species_names: "pokemon_species_id,local_language_id,name,genus\n263,6,Zigzachs,Kleindachs-Pokémon\n263,7,Zigzagoon,Pokémon Mapachito\n263,9,Zigzagoon,Tiny Raccoon Pokémon\n",
      moves: "id,type_id,generation_id\n52,10,1\n",
      move_names: "move_id,local_language_id,name\n52,6,Glut\n52,7,Ascuas\n52,9,Ember\n",
      type_names: "type_id,local_language_id,name\n10,6,Feuer\n10,7,Fuego\n10,9,Fire\n",
      abilities: "id,generation_id\n", ability_names: "ability_id,local_language_id,name\n",
      items: "id,category_id\n", item_names: "item_id,local_language_id,name\n", item_game_indices: "item_id,generation_id\n",
      item_category_prose: "item_category_id,local_language_id,name\n", item_flavor_text: "item_id,version_group_id,language_id,flavor_text\n",
      locations: "id,region_id\n", location_names: "location_id,local_language_id,name\n",
    };
    const names = buildNames(csv);
    assert.equal(names.species[0]?.es, "Zigzagoon");
    const glossary = loadGlossary(nameEntries(names, { generation: 3, regions: [3] }, "es"), "es");
    assert.equal(glossary.get("ASCUAS")?.mt, "Ember");
    assert.match(glossary.get("Ascuas")?.glosses[1] ?? "", /tipo Fuego/);
    assert.equal(glossary.get("Glut"), undefined, "German names are not Spanish");
    assert.equal(glossary.get("Ang"), undefined, "the German stat abbreviations don't apply");
  });
});
