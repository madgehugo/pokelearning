import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hiddenKeyOf, hiddenWordOf, UNKNOWN_POS } from "@pokelearning/shared";

describe("hiddenWordOf", () => {
  it("hides a word the dictionary knows under its lemma", () => {
    const w = hiddenWordOf({ text: "Häusern", kind: "word", best: { lemma: "Haus", pos: "noun", glosses: ["house"] } });
    assert.deepEqual(w, { lemma: "Haus", pos: "noun" });
  });

  it("hides one it doesn't know (a player's name) under its lowercase spelling", () => {
    assert.deepEqual(hiddenWordOf({ text: "AAa", kind: "word" }), { lemma: "aaa", pos: UNKNOWN_POS });
    assert.equal(hiddenKeyOf({ text: "AAa", kind: "word" }), `aaa|${UNKNOWN_POS}`);
  });

  it("can't hide punctuation", () => {
    assert.equal(hiddenWordOf({ text: "!", kind: "punct" }), null);
  });
});
