import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { menuRows as rows_ } from "@pokelearning/shared";

const menuRows = (text: string, translation: string | undefined, source = "menu") =>
  rows_({ source, text, translation: translation === undefined ? null : { text: translation } });

describe("menuRows", () => {
  it("pairs each label with its translation and keeps its place in the text", () => {
    const text = "WEITER\nSPIELZEIT\nOPTION";
    const rows = menuRows(text, "CONTINUE\nPLAY TIME\nOPTION")!;
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => text.slice(r.start, r.end)), ["WEITER", "SPIELZEIT", "OPTION"]);
    assert.deepEqual(rows.map((r) => r.translation), ["CONTINUE", "PLAY TIME", "OPTION"]);
  });

  it("skips blank lines on both sides, like the pipeline does", () => {
    const rows = menuRows("EINS\n\nZWEI", "ONE\nTWO")!;
    assert.deepEqual(rows.map((r) => r.translation), ["ONE", "TWO"]);
    assert.equal(rows[1]!.start, 6);
  });

  it("gives up when the counts differ, there is no translation, or it's a single label", () => {
    assert.equal(menuRows("A\nB\nC", "x\ny"), null);
    assert.equal(menuRows("A\nB", undefined), null);
    assert.equal(menuRows("ONLY", "ONLY"), null);
  });

  it("only applies to menu lines", () => {
    assert.equal(menuRows("Hallo\nWelt", "Hello\nworld", "field"), null);
  });
});
