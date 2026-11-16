import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fixtureDictionary } from "../test-fixtures.ts";
import { prepareForTranslation, prepareSentences } from "../translate/prepare.ts";
import { analyzeLine } from "./analyze.ts";
import { createGlossary } from "./glossary.ts";
import { buildNames, nameEntries, parseCsv } from "./names.ts";

// Tiny PokéAPI-shaped tables: language 6 is German, 9 English.
const csv = {
  pokemon_species: "id,identifier,generation_id\n263,zigzagoon,3\n387,turtwig,4\n",
  pokemon_species_names:
    "pokemon_species_id,local_language_id,name,genus\n" +
    "263,6,Zigzachs,Kleindachs-Pokémon\n263,9,Zigzagoon,Tiny Raccoon Pokémon\n263,5,Zigzaton,Pokémon Petit Raton\n" +
    '387,6,Chelast,Winzlaub-Pokémon\n387,9,Turtwig,"Tiny Leaf Pokémon"\n',
  moves: "id,identifier,generation_id,type_id\n52,ember,1,10\n33,tackle,1,1\n",
  move_names: "move_id,local_language_id,name\n52,6,Glut\n52,9,Ember\n33,6,Tackle\n33,9,Tackle\n",
  type_names: "type_id,local_language_id,name\n10,6,Feuer\n10,9,Fire\n1,6,Normal\n1,9,Normal\n",
};

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, commas and CRLF", () => {
    assert.deepEqual(parseCsv('a,b\r\n1,"x, ""y"""\r\n2,\r\n'), [{ a: "1", b: 'x, "y"' }, { a: "2", b: "" }]);
  });
});

describe("Pokémon names", () => {
  const names = buildNames(csv);
  const glossary = createGlossary(nameEntries(names, 3));
  const deps = { dictionary: fixtureDictionary(), glossary };
  const word = (line: string, text: string) => analyzeLine(line, deps).tokens.find((t) => t.text === text)!;

  it("joins German and English names, categories, generations and move types", () => {
    assert.deepEqual(names.species[0], {
      id: 263, generation: 3, de: "Zigzachs", en: "Zigzagoon", genusDe: "Kleindachs-Pokémon", genusEn: "Tiny Raccoon Pokémon",
    });
    assert.equal(names.species[1]?.genusEn, "Tiny Leaf Pokémon");
    assert.deepEqual(names.moves.find((m) => m.id === 52), {
      id: 52, generation: 1, de: "Glut", en: "Ember", typeDe: "Feuer", typeEn: "Fire",
    });
  });

  it("only uses names up to the game's generation", () => {
    assert.equal(glossary.get("Chelast"), undefined);
    assert.equal(glossary.get("Zigzachs")?.mt, "Zigzagoon");
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

  it("hands names to the translator as placeholders, but only in capitals", () => {
    assert.deepEqual(prepareSentences("ZIGZACHS setzt GLUT ein!", glossary), [
      { text: "X1 setzt X2 ein!", slots: ["Zigzagoon", "Ember"] },
    ]);
    assert.equal(prepareForTranslation("Die Glut ist heiß.", glossary), "Die Glut ist heiß.");
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
});
