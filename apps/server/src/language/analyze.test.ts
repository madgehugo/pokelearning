import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TokenAnalysis } from "@pokelearning/shared";
import { fixtureDictionary } from "../test-fixtures.ts";
import { analyzeLine } from "./analyze.ts";
import { createGlossary } from "./glossary.ts";
import { isAllCaps, titleCase, tokenize } from "./tokenize.ts";

const glossary = createGlossary([
  { match: ["Pokémon-Center"], lemma: "Pokémon-Center", pos: "noun", gender: "n", glosses: ["Pokémon Center"] },
  { match: ["Birk"], lemma: "Birk", pos: "name", glosses: ["Professor Birch"], mt: "Birch" },
]);
const deps = { dictionary: fixtureDictionary(), glossary };

const words = (line: string) => analyzeLine(line, deps).tokens.filter((t) => t.kind === "word");
const word = (line: string, text: string): TokenAnalysis => words(line).find((t) => t.text === text)!;

describe("tokenize", () => {
  it("keeps compounds, apostrophes and placeholders together", () => {
    assert.deepEqual(
      tokenize("Na, geht's {PLAYER}? POKéMON-CENTER…").map((t) => [t.text, t.kind]),
      [
        ["Na", "word"], [",", "punct"], ["geht's", "word"], ["{PLAYER}", "placeholder"],
        ["?", "punct"], ["POKéMON-CENTER", "word"], ["…", "punct"],
      ],
    );
  });

  it("recognises Gen 3 capitals", () => {
    assert.ok(isAllCaps("POKéMON"));
    assert.ok(isAllCaps("KP"));
    assert.ok(!isAllCaps("Pokémon"));
    assert.ok(!isAllCaps("A"));
    assert.equal(titleCase("POKéMON-CENTER"), "Pokémon-Center");
  });
});

describe("analyzeLine", () => {
  it("gives nouns their article and plural, and the form's grammar", () => {
    const t = word("Die Häusern sind alt.", "Häusern");
    assert.equal(t.best?.lemma, "Haus");
    assert.deepEqual(t.best?.articles, ["das"]);
    assert.equal(t.best?.plural, "Häuser");
    assert.equal(t.best?.formTags, "dative plural");
  });

  it("links a separable verb to its particle in the same clause", () => {
    const tokens = words("Ruh dich gut aus!");
    const verb = tokens.find((t) => t.text === "Ruh")!;
    const particle = tokens.find((t) => t.text === "aus")!;
    assert.equal(verb.best?.lemma, "ausruhen");
    assert.equal(verb.best?.particle, "aus");
    assert.equal(particle.best?.lemma, "ausruhen");
    assert.equal(particle.best?.formTags, "separated prefix");
    assert.equal(particle.alternatives?.[0]?.lemma, "aus", "own reading kept as alternative");
    assert.ok(verb.linkedTo !== undefined && particle.linkedTo !== undefined);
  });

  it("does not use the separable reading without the particle", () => {
    assert.equal(word("Ich ruhe.", "ruhe").best?.lemma, "ruhen");
  });

  it("only links a particle at the end of the clause", () => {
    assert.equal(word("Er wartet auf dich.", "wartet").best?.lemma, "warten");
    assert.equal(word("Er wartet auf dich.", "auf").best?.lemma, "auf");
    assert.equal(word("Er wartet gut auf.", "wartet").best?.lemma, "aufwarten");
  });

  it("does not link a particle from the next clause", () => {
    assert.equal(word("Ich ruhe, aus Prinzip.", "ruhe").best?.lemma, "ruhen");
  });

  it("prefers a present-tense reading over another verb's subjunctive", () => {
    const deps2 = {
      dictionary: fixtureDictionary([
        { word: "führen", pos: "verb", senses: [{ glosses: ["to lead"] }], forms: [{ form: "führt", tags: ["indicative", "present", "singular", "third-person"] }] },
        { word: "fahren", pos: "verb", senses: [{ glosses: ["to drive"] }, { glosses: ["to go"] }, { glosses: ["to ride"] }], forms: [{ form: "führt", tags: ["plural", "second-person", "subjunctive-ii"] }] },
      ]),
      glossary,
    };
    assert.equal(analyzeLine("Der Weg führt dorthin.", deps2).tokens.find((t) => t.text === "führt")?.best?.lemma, "führen");
  });

  it("does not read a lowercase word as a noun", () => {
    assert.equal(word("Ich ruhe.", "ruhe").best?.pos, "verb");
    assert.equal(word("Die Ruhe.", "Ruhe").best?.lemma, "Ruhe");
  });

  it("prefers the pronoun over the noun at the start of a sentence", () => {
    assert.equal(word("Ich bin gut.", "Ich").best?.lemma, "ich");
  });

  it("prefers a word's own form-of entry over another word's table", () => {
    assert.equal(word("Ruh dich aus.", "dich").best?.lemma, "du");
  });

  it("normalises Gen 3 capitals and uses the glossary", () => {
    const center = word("Im POKéMON-CENTER.", "POKéMON-CENTER");
    assert.equal(center.normalized, "Pokémon-Center");
    assert.equal(center.best?.source, "glossary");
    assert.equal(word("Ich bin BIRK.", "BIRK").best?.glosses[0], "Professor Birch");
  });

  it("analyses unknown hyphenated compounds part by part", () => {
    const t = word("Das POKéMON-HAUS.", "POKéMON-HAUS");
    assert.equal(t.best, undefined);
    assert.deepEqual(t.parts?.map((p) => p.best?.lemma), ["Pokémon", "Haus"]);
  });

  it("leaves unknown words without a reading", () => {
    assert.equal(word("Ein ZIGZACHS!", "ZIGZACHS").best, undefined);
  });

  it("works without a dictionary", () => {
    const a = analyzeLine("Hallo BIRK!", { dictionary: null, glossary });
    assert.equal(a.dictionaryVersion, null);
    assert.equal(a.tokens[1]?.best?.lemma, "Birk");
    assert.equal(a.tokens[0]?.best, undefined);
  });
});
