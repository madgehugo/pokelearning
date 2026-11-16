import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanText, fixEszett, Stabilizer } from "./stabilizer.ts";

const feed = (readings: string[], options = {}) => {
  const s = new Stabilizer(options);
  return readings.map((r) => s.push(r)).filter((x): x is string => x !== null);
};

describe("cleanText", () => {
  it("joins lines, keeps hyphens at breaks, fixes ß read as B", () => {
    assert.equal(cleanText("Möchtest du dich im POKéMON-\nCENTER ausruhen?"), "Möchtest du dich im POKéMON-CENTER ausruhen?");
    assert.equal(cleanText("Süße GrüBe aus\nWURZELHEIM!"), "Süße Grüße aus WURZELHEIM!");
    assert.equal(fixEszett("Er heiBt BIRK. Das ist groB."), "Er heißt BIRK. Das ist groß.");
    assert.equal(fixEszett("BIRK, Bälle, BLÜTENBURG"), "BIRK, Bälle, BLÜTENBURG", "capital B elsewhere stays");
  });
});

describe("Stabilizer", () => {
  it("waits until typing has finished", () => {
    assert.deepEqual(feed(["Ein wil", "Ein wildes ZIG", "Ein wildes ZIGZACHS erscheint!", "Ein wildes ZIGZACHS erscheint!"]), [
      "Ein wildes ZIGZACHS erscheint!",
    ]);
  });

  it("sends a message once while it stays on screen, despite OCR wobble", () => {
    assert.deepEqual(feed(["Hallo, BIRK!", "Hallo , BIRK!", "Hallo, BIRK!", "hallo, birk!", "Hallo, BIRK!"]), ["Hallo, BIRK!"]);
  });

  it("sends each page of a message", () => {
    assert.deepEqual(feed(["Seite eins hier.", "Seite eins hier.", "", "Seite zwei da.", "Seite zwei da."]), [
      "Seite eins hier.",
      "Seite zwei da.",
    ]);
  });

  it("sends the same message again after the box closed", () => {
    assert.deepEqual(feed(["Wie geht's?", "Wie geht's?", "", "", "Wie geht's?", "Wie geht's?"]), ["Wie geht's?", "Wie geht's?"]);
  });

  it("ignores the box being redrawn with part of the sent text", () => {
    assert.deepEqual(feed(["Ein wildes ZIGZACHS erscheint!", "Ein wildes ZIGZACHS erscheint!", "Ein wildes", "Ein wildes"]), [
      "Ein wildes ZIGZACHS erscheint!",
    ]);
  });

  it("treats tiny readings as an empty box", () => {
    assert.deepEqual(feed(["▼", "▼", "ok", "ok"]), []);
  });
});
