import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LineMessage } from "@pokelearning/shared";
import { AppDb } from "./db/app-db.ts";
import { createGlossary } from "./language/glossary.ts";
import { LinePipeline } from "./pipeline.ts";
import { prepareForTranslation, restoreSlots, splitSentences } from "./translate/prepare.ts";
import type { TranslationProvider } from "./translate/provider.ts";
import { Translator } from "./translate/translator.ts";

const glossary = createGlossary([
  { match: ["Birk"], lemma: "Birk", pos: "name", glosses: ["Professor Birch"], mt: "Birch" },
]);

class FakeProvider implements TranslationProvider {
  readonly id = "fake";
  calls: string[] = [];
  fail = false;
  async warmUp() {}
  async translate(text: string) {
    if (this.fail) throw new Error("model exploded");
    this.calls.push(text);
    return `EN(${text})`;
  }
}

const line = (text: string): LineMessage => ({
  type: "line", adapter: "test", game: "pokemon-emerald-de", lang: "de", line: text, timestamp: 0, meta: { source: "field" },
});

function setup() {
  const db = new AppDb(":memory:");
  const provider = new FakeProvider();
  const pipeline = new LinePipeline(db, { dictionary: null, glossary }, new Translator(provider, db, glossary), "en");
  return { db, provider, pipeline };
}

describe("prepareForTranslation", () => {
  it("normalises capitals, keeps acronyms, protects glossary names", () => {
    assert.equal(
      prepareForTranslation("Ich bin PROF. BIRK. Dein POKéMON hat keine KP!", glossary),
      "Ich bin Prof. X1. Dein Pokémon hat keine KP!",
    );
  });

  it("restores placeholders, or reports one that went missing", () => {
    assert.equal(restoreSlots("X2 uses X1!", ["Ember", "Zigzagoon"]), "Zigzagoon uses Ember!");
    assert.equal(restoreSlots("You got an X1!", ["Super Potion"]), "You got a Super Potion!");
    assert.equal(restoreSlots("A X1 hits.", ["Ember"]), "An Ember hits.");
    assert.equal(restoreSlots("Zigzagoon uses fire!", ["Zigzagoon"]), null);
  });

  it("splits sentences but not after abbreviations", () => {
    assert.deepEqual(splitSentences("Hallo! Ich bin Prof. Birch. Und du?"), ["Hallo!", "Ich bin Prof. Birch.", "Und du?"]);
  });
});

describe("LinePipeline", () => {
  it("stores, translates per sentence and emits the line", async () => {
    const { db, provider, pipeline } = setup();
    const emitted: unknown[] = [];
    pipeline.on("line", (l) => emitted.push(l));

    const out = await pipeline.submit(line("Hallo! Ich bin BIRK."));
    assert.equal(out?.translation?.text, "EN(Hallo!) EN(Ich bin Birch.)");
    assert.equal(out?.translation?.cached, false);
    assert.equal(out?.source, "field");
    assert.ok(out?.analysis);
    assert.deepEqual(provider.calls, ["Hallo!", "Ich bin X1."]);
    assert.equal(emitted.length, 1);

    const row = db.db.prepare("SELECT text, translation FROM lines WHERE id = ?").get(out!.id) as Record<string, string>;
    assert.equal(row.translation, "EN(Hallo!) EN(Ich bin Birch.)");
    assert.ok(db.db.prepare("SELECT 1 FROM line_analyses WHERE line_id = ?").get(out!.id));
  });

  it("falls back to written-in names if the translator drops a placeholder", async () => {
    const db = new AppDb(":memory:");
    const provider = new FakeProvider();
    provider.translate = async (text: string) => {
      provider.calls.push(text);
      return text.includes("X1") ? "Hello there!" : `EN(${text})`;
    };
    const pipeline = new LinePipeline(db, { dictionary: null, glossary }, new Translator(provider, db, glossary), "en");
    const out = await pipeline.submit(line("Ich bin BIRK."));
    assert.equal(out?.translation?.text, "EN(Ich bin Birch.)");
    assert.deepEqual(provider.calls, ["Ich bin X1.", "Ich bin Birch."]);
  });

  it("serves repeated sentences from the cache", async () => {
    const { provider, pipeline } = setup();
    await pipeline.submit(line("Hallo!"));
    const second = await pipeline.submit(line("Hallo! Tschüss!"));
    assert.deepEqual(provider.calls, ["Hallo!", "Tschüss!"]);
    assert.equal(second?.translation?.cached, false);
    const third = await pipeline.submit(line("Hallo! Tschüss!"));
    assert.equal(third?.translation?.cached, true);
  });

  it("keeps the line when translation fails", async () => {
    const { provider, pipeline } = setup();
    const errors: string[] = [];
    pipeline.on("error", (e) => errors.push(e.message));
    provider.fail = true;
    const out = await pipeline.submit(line("Hallo!"));
    assert.equal(out?.translation, null);
    assert.ok(out?.analysis);
    assert.deepEqual(errors, ["model exploded"]);
  });

  it("counts how often a line came up before", async () => {
    const { pipeline } = setup();
    assert.equal((await pipeline.submit(line("Hallo!")))?.seenBefore, 0);
    await pipeline.submit(line("Tschüss!"));
    assert.equal((await pipeline.submit(line("Hallo!")))?.seenBefore, 1);
    assert.equal((await pipeline.submit(line("Hallo!")))?.seenBefore, 2);
  });

  it("processes lines in arrival order", async () => {
    const { pipeline } = setup();
    const order: string[] = [];
    pipeline.on("line", (l) => order.push(l.text));
    await Promise.all(["eins", "zwei", "drei"].map((t) => pipeline.submit(line(t))));
    assert.deepEqual(order, ["eins", "zwei", "drei"]);
  });
});
