import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ENTRIES, fixtureDictionary } from "../test-fixtures.ts";
import { convertEntry } from "./kaikki.ts";

const entry = (word: string, pos?: string) => ENTRIES.find((e) => e.word === word && (!pos || e.pos === pos))!;

describe("convertEntry", () => {
  it("reads noun gender and plural, skips table metadata", () => {
    const { lexeme, forms } = convertEntry(entry("Haus"));
    assert.equal(lexeme?.gender, "n");
    assert.equal(lexeme?.plural, "Häuser");
    assert.deepEqual(forms.map((f) => f.form).sort(), ["Haus", "Hauses", "Häuschen", "Häuser"].sort());
  });

  it("turns form-of entries into pending forms, not lexemes", () => {
    const { lexeme, pending } = convertEntry(entry("bin"));
    assert.equal(lexeme, null);
    assert.deepEqual(pending, [{ form: "bin", lemma: "sein", pos: "verb", tags: "first-person present singular" }]);
  });

  it("treats letter-case and spelling variants as forms", () => {
    const { lexeme, pending } = convertEntry(entry("Dein"));
    assert.equal(lexeme, null);
    assert.equal(pending[0]?.lemma, "dein");
    assert.equal(pending[0]?.tags, "alternative form");
  });

  it("keeps contractions as real words", () => {
    const { lexeme } = convertEntry(entry("im"));
    assert.equal(lexeme?.senses[0]?.gloss, "contraction of in + dem; in the");
  });

  it("puts auxiliary senses after the main meaning", () => {
    assert.equal(convertEntry(entry("sein")).lexeme?.senses[0]?.gloss, "to be");
  });

  it("stores split separable-verb forms with their particle", () => {
    const { lexeme, forms } = convertEntry(entry("ausruhen"));
    assert.equal(lexeme?.particle, "aus");
    assert.deepEqual(
      forms.filter((f) => f.particle).map((f) => f.form).sort(),
      ["ruh", "ruhe"],
    );
    assert.ok(!forms.some((f) => f.form.includes(" ")), "multi-word forms are dropped");
  });

  it("skips affixes", () => {
    assert.equal(convertEntry(entry("-chen")).lexeme, null);
  });
});

describe("dictionary database", () => {
  const dict = fixtureDictionary();

  it("finds inflected forms case-insensitively", () => {
    const matches = dict.lookup("häusern");
    assert.equal(matches[0]?.lexeme.lemma, "Haus");
    assert.equal(matches[0]?.formTags, "dative plural");
  });

  it("resolves form-of entries and marks them direct", () => {
    const bin = dict.lookup("bin").filter((m) => m.lexeme.lemma === "sein");
    assert.ok(bin.some((m) => m.direct));
    assert.ok(bin.some((m) => !m.direct), "sein's own form table also lists bin");
  });

  it("records the version", () => {
    assert.equal(dict.version, "test");
  });
});
