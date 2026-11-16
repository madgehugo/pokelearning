import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LineMessage } from "@pokelearning/shared";
import { AppDb } from "../db/app-db.ts";
import { LinePipeline } from "../pipeline.ts";
import { fixtureDictionary } from "../test-fixtures.ts";
import { prepareForTranslation, prepareSentences } from "../translate/prepare.ts";
import { Scheduler } from "../wordbank/scheduler.ts";
import { WordBank } from "../wordbank/wordbank.ts";
import { analyzeLine } from "./analyze.ts";
import { createGlossary } from "./glossary.ts";
import { buildNames, nameEntries, parseCsv, type NameTables } from "./names.ts";

// Tiny PokéAPI-shaped tables: language 6 is German, 9 English, 5 French (ignored).
const csv: NameTables = {
  pokemon_species: "id,identifier,generation_id\n263,zigzagoon,3\n387,turtwig,4\n",
  pokemon_species_names:
    "pokemon_species_id,local_language_id,name,genus\n" +
    "263,6,Zigzachs,Kleindachs-Pokémon\n263,9,Zigzagoon,Tiny Raccoon Pokémon\n263,5,Zigzaton,Pokémon Petit Raton\n" +
    '387,6,Chelast,Winzlaub-Pokémon\n387,9,Turtwig,"Tiny Leaf Pokémon"\n',
  moves: "id,identifier,generation_id,type_id\n52,ember,1,10\n33,tackle,1,1\n270,helping-hand,3,1\n",
  move_names:
    "move_id,local_language_id,name\n52,6,Glut\n52,9,Ember\n33,6,Tackle\n33,9,Tackle\n270,6,Rechte Hand\n270,9,Helping Hand\n",
  type_names: "type_id,local_language_id,name\n10,6,Feuer\n10,9,Fire\n1,6,Normal\n1,9,Normal\n",
  abilities: "id,identifier,generation_id,is_main_series\n65,overgrow,3,1\n66,blaze,3,1\n",
  ability_names: "ability_id,local_language_id,name\n65,6,Notdünger\n65,9,Overgrow\n66,6,Großbrand\n66,9,Blaze\n",
  items: "id,identifier,category_id,cost\n17,potion,27,200\n26,super-potion,27,700\n4,poke-ball,34,200\n",
  item_names:
    "item_id,local_language_id,name\n17,6,Trank\n17,9,Potion\n26,6,Supertrank\n26,9,Super Potion\n4,6,Pokéball\n4,9,Poké Ball\n",
  item_game_indices: "item_id,generation_id,game_index\n17,3,13\n17,4,17\n26,3,22\n4,3,4\n",
  item_category_prose: "item_category_id,local_language_id,name\n27,6,Heilung\n27,9,Healing\n34,6,Standardbälle\n34,9,Standard balls\n",
  item_flavor_text:
    "item_id,version_group_id,language_id,flavor_text\n" +
    '17,6,9,"Restores the HP of\na POKéMON by\n20 points."\n17,5,9,Old text\n26,6,9,Restores HP by 50 points.\n',
  locations: "id,region_id,identifier\n429,3,petalburg-city\n567,3,littleroot-town\n449,3,hoenn-route-101\n1,4,canalave-city\n",
  location_names:
    "location_id,local_language_id,name,subtitle\n429,6,Blütenburg City,\n429,9,Petalburg City,\n" +
    "567,6,Wurzelheim,\n567,9,Littleroot Town,\n449,6,Route 101,\n449,9,Route 101,\n1,6,Fleetburg,\n1,9,Canalave City,\n",
};

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, commas, line breaks in fields and CRLF", () => {
    assert.deepEqual(parseCsv('a,b\r\n1,"x, ""y"""\r\n2,"two\nlines"\r\n'), [
      { a: "1", b: 'x, "y"' },
      { a: "2", b: "two\nlines" },
    ]);
  });
});

describe("game names", () => {
  const names = buildNames(csv);
  const glossary = createGlossary(nameEntries(names, { generation: 3, regions: [3] }));
  const deps = { dictionary: fixtureDictionary(), glossary };
  const word = (line: string, text: string) => analyzeLine(line, deps).tokens.find((t) => t.text === text)!;

  it("joins German and English names with their details", () => {
    assert.deepEqual(names.species[0], {
      id: 263, generation: 3, de: "Zigzachs", en: "Zigzagoon", genusDe: "Kleindachs-Pokémon", genusEn: "Tiny Raccoon Pokémon",
    });
    assert.equal(names.species[1]?.genusEn, "Tiny Leaf Pokémon");
    assert.deepEqual(names.moves.find((m) => m.id === 52), {
      id: 52, generation: 1, de: "Glut", en: "Ember", typeDe: "Feuer", typeEn: "Fire",
    });
    assert.deepEqual(names.items.find((i) => i.id === 17), {
      id: 17, generations: [3, 4], de: "Trank", en: "Potion", categoryDe: "Heilung", categoryEn: "Healing",
      descriptionEn: "Restores the HP of a POKéMON by 20 points.",
    });
    assert.deepEqual(names.abilities[0], { id: 65, generation: 3, de: "Notdünger", en: "Overgrow" });
    assert.deepEqual(names.places.find((p) => p.id === 429), { id: 429, region: 3, de: "Blütenburg City", en: "Petalburg City" });
  });

  it("only uses names from the game's generation and region", () => {
    assert.equal(glossary.get("Chelast"), undefined);
    assert.equal(glossary.get("Fleetburg"), undefined);
    assert.equal(glossary.get("Zigzachs")?.mt, "Zigzagoon");
    assert.equal(glossary.get("Notdünger")?.pos, "ability");
    assert.equal(glossary.get("Wurzelheim")?.mt, "Littleroot Town");
  });

  it("reads Gen 3 capitals as the Pokémon or move", () => {
    const z = word("ZIGZACHS setzt GLUT ein!", "ZIGZACHS");
    assert.equal(z.best?.pos, "pokemon");
    assert.deepEqual(z.best?.glosses, ["Zigzagoon", "No. 263, the Kleindachs-Pokémon (Tiny Raccoon Pokémon)"]);
    const g = word("ZIGZACHS setzt GLUT ein!", "GLUT");
    assert.equal(g.best?.pos, "move");
    assert.deepEqual(g.best?.glosses, ["Ember", "Fire-type move (Typ Feuer)"]);
    assert.equal(g.alternatives?.[0]?.lemma, "Glut", "the noun stays available");
  });

  it("keeps the dictionary reading in normal text, with the move as an alternative", () => {
    const g = word("Die Glut ist gut.", "Glut");
    assert.equal(g.best?.pos, "noun");
    assert.equal(g.alternatives?.[0]?.pos, "move");
  });

  it("uses a name in normal case when the dictionary doesn't know the word", () => {
    assert.equal(word("Mein Zigzachs ist gut.", "Zigzachs").best?.pos, "pokemon");
  });

  it("gives items their gender, from the dictionary or the compound's last part", () => {
    const trank = word("Du hast einen TRANK erhalten!", "TRANK").best!;
    assert.deepEqual([trank.pos, trank.articles, trank.glosses], [
      "item", ["der"], ["Potion", "Healing item (Heilung)", "Restores the HP of a POKéMON by 20 points."],
    ]);
    assert.deepEqual(word("Ein SUPERTRANK!", "SUPERTRANK").best?.articles, ["der"]);
    assert.deepEqual(word("Ein POKéBALL!", "POKéBALL").best?.articles, ["der"]);
  });

  it("matches ß in names to SS in capitals", () => {
    assert.equal(word("Die Fähigkeit GROSSBRAND!", "GROSSBRAND").best?.glosses[0], "Blaze");
  });

  it("recognises items in the plural", () => {
    const balls = word("Du hast 5 POKéBÄLLE gekauft.", "POKéBÄLLE").best!;
    assert.deepEqual([balls.lemma, balls.articles, balls.formTags], ["Pokéball", ["der"], "plural"]);
  });

  it("matches multi-word names written in capitals as one", () => {
    const tokens = analyzeLine("Willkommen in BLÜTENBURG CITY!", deps).tokens;
    const head = tokens.find((t) => t.text === "BLÜTENBURG")!;
    const city = tokens.find((t) => t.text === "CITY")!;
    assert.equal(head.best?.glosses[0], "Petalburg City");
    assert.equal(head.phraseEnd, city.end);
    assert.equal(city.partOf, tokens.indexOf(head));
    assert.equal(city.best, undefined);
    assert.equal(word("Ich nutze RECHTE HAND.", "RECHTE").best?.glosses[0], "Helping Hand");
    assert.equal(word("Auf ROUTE 101 ist es gut.", "ROUTE").best?.pos, "place");
    assert.equal(word("Die rechte Hand ist gut.", "rechte").partOf, undefined, "not in capitals: no name");
  });

  it("hands names to the translator as placeholders, but only in capitals", () => {
    assert.deepEqual(prepareSentences("ZIGZACHS setzt GLUT ein!", glossary), [
      { text: "X1 setzt X2 ein!", slots: ["Zigzagoon", "Ember"] },
    ]);
    assert.equal(prepareForTranslation("Die Glut ist heiß.", glossary), "Die Glut ist heiß.");
    assert.deepEqual(prepareSentences("Willkommen in BLÜTENBURG CITY!", glossary), [
      { text: "Willkommen in X1!", slots: ["Petalburg City"] },
    ]);
  });

  it("numbers placeholders per sentence, so sentences share cache entries", () => {
    assert.deepEqual(prepareSentences("Los! ZIGZACHS! Ein wildes ZIGZACHS erscheint!", glossary), [
      { text: "Los!", slots: [] },
      { text: "X1!", slots: ["Zigzagoon"] },
      { text: "Ein wildes X1 erscheint!", slots: ["Zigzagoon"] },
    ]);
  });

  it("protects game phrases and leaves text that already has X1 alone", () => {
    assert.deepEqual(prepareSentences("ZIGZACHS erhält 15 E.-Punkte!", glossary)[0], {
      text: "X1 erhält 15 X2!",
      slots: ["Zigzagoon", "Exp. Points"],
    });
    assert.deepEqual(prepareSentences("Feld X1 für ZIGZACHS.", glossary)[0], { text: "Feld X1 für Zigzagoon.", slots: [] });
  });

  it("saves items with an article card, and places with the whole name as example", async () => {
    const db = new AppDb(":memory:");
    const bank = new WordBank(db, new Scheduler({ fuzz: false }));
    const pipeline = new LinePipeline(db, deps, null, "en");
    const msg = (line: string): LineMessage => ({ type: "line", adapter: "t", game: "g", lang: "de", line, timestamp: 0 });
    const potion = (await pipeline.submit(msg("Du hast einen TRANK erhalten!")))!;
    const saved = bank.save({ lineId: potion.id, tokenIndex: potion.analysis!.tokens.findIndex((t) => t.text === "TRANK") });
    assert.deepEqual(saved.cards.map((c) => c.kind), ["meaning", "article"]);
    const town = (await pipeline.submit(msg("Willkommen in BLÜTENBURG CITY!")))!;
    const place = bank.save({ lineId: town.id, tokenIndex: town.analysis!.tokens.findIndex((t) => t.text === "BLÜTENBURG") });
    assert.deepEqual([place.contexts[0]?.form, place.contexts[0]?.start], ["BLÜTENBURG CITY", 14]);
  });
});
