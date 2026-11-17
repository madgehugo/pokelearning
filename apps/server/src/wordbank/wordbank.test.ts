import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { LineMessage, ProcessedLine } from "@pokelearning/shared";
import { AppDb } from "../db/app-db.ts";
import { createGlossary } from "../language/glossary.ts";
import { LinePipeline } from "../pipeline.ts";
import { fixtureDictionary } from "../test-fixtures.ts";
import { formatInterval, Scheduler } from "./scheduler.ts";
import { dayStart, WordBank } from "./wordbank.ts";

const dictionary = fixtureDictionary();
const glossary = createGlossary([]);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
// a fixed Monday 12:00 local time, so "today" doesn't depend on when tests run
const T0 = new Date(2026, 10, 16, 12, 0, 0).getTime();

let db: AppDb;
let bank: WordBank;
let pipeline: LinePipeline;

const msg = (line: string): LineMessage => ({
  type: "line", adapter: "t", game: "pokemon-emerald-de", lang: "de", line, timestamp: 0,
});
const play = async (text: string) => (await pipeline.submit(msg(text)))!;
const tokenIndex = (line: ProcessedLine, text: string) => line.analysis!.tokens.findIndex((t) => t.text === text);
const save = (line: ProcessedLine, text: string, now = T0) =>
  bank.save({ lineId: line.id, tokenIndex: tokenIndex(line, text) }, now);

beforeEach(() => {
  db = new AppDb(":memory:");
  bank = new WordBank(db, new Scheduler({ fuzz: false }));
  pipeline = new LinePipeline(db, { dictionary, glossary }, null, "en");
  pipeline.on("line", (l) => bank.recordLine(l));
});

describe("hidden words", () => {
  it("hides and shows a word, and saving it shows it again", async () => {
    bank.hide({ lemma: "gut", pos: "adj", gloss: "good" });
    bank.hide({ lemma: "gut", pos: "adj", gloss: "good" }); // twice is fine
    assert.deepEqual(bank.hiddenWords(), [{ lemma: "gut", pos: "adj", gloss: "good" }]);
    const word = save(await play("Ich bin gut."), "gut");
    assert.equal(bank.hiddenWords().length, 0, `saving ${word.lemma} un-hides it`);
    bank.hide({ lemma: "Haus", pos: "noun", gloss: "house" });
    bank.unhide("Haus", "noun");
    assert.deepEqual(bank.hiddenWords(), []);
  });

  it("needs a lemma and a part of speech", () => {
    assert.throws(() => bank.hide({ lemma: "", pos: "noun", gloss: "" }), /required/);
  });
});

describe("saving words", () => {
  it("saves a noun with a meaning and an article card, and its sentence", async () => {
    const line = await play("Die Häusern sind gut.");
    const word = save(line, "Häusern");
    assert.equal(word.lemma, "Haus");
    assert.deepEqual(word.articles, ["das"]);
    assert.equal(word.plural, "Häuser");
    assert.deepEqual(word.cards.map((c) => c.kind), ["meaning", "article"]);
    assert.ok(word.cards.every((c) => c.state === "new"));
    assert.deepEqual(word.contexts.map((c) => [c.text, c.form, c.start]), [["Die Häusern sind gut.", "Häusern", 4]]);
    assert.deepEqual(bank.savedKeys(), ["Haus|noun"]);
  });

  it("gives other words only a meaning card", async () => {
    const word = save(await play("Ich bin gut."), "gut");
    assert.deepEqual(word.cards.map((c) => c.kind), ["meaning"]);
  });

  it("counts earlier lines and keeps them as examples", async () => {
    await play("Ich ruhe.");
    await play("Ich ruhe.");
    await play("Ruh dich gut aus!");
    const line = await play("Ich bin gut.");
    const word = save(line, "gut");
    assert.equal(word.encounters, 2, "both lines with gut, the repeat of 'Ich ruhe.' doesn't count");
    assert.deepEqual(word.contexts.map((c) => c.text), ["Ich bin gut.", "Ruh dich gut aus!"]);
  });

  it("counts later lines and adds new sentences once", async () => {
    const word = save(await play("Ich bin gut."), "gut");
    await play("Ruh dich gut aus!");
    await play("Ruh dich gut aus!");
    const after = bank.get(word.id)!;
    assert.equal(after.encounters, 3);
    assert.deepEqual(after.contexts.map((c) => c.text), ["Ruh dich gut aus!", "Ich bin gut."]);
  });

  it("uses the verb, not its separated prefix, as the example form", async () => {
    const word = save(await play("Ruh dich gut aus!"), "aus");
    assert.equal(word.lemma, "ausruhen");
    assert.equal(word.contexts[0]?.form, "Ruh");
  });

  it("saving the same word again adds the example, not a second word", async () => {
    save(await play("Ich bin gut."), "gut");
    save(await play("Ruh dich gut aus!"), "gut");
    assert.equal(bank.list().length, 1);
  });

  it("rejects unknown lines and tokens", async () => {
    assert.throws(() => bank.save({ lineId: 999, tokenIndex: 0 }), /isn't stored/);
    const line = await play("Ich bin gut.");
    assert.throws(() => bank.save({ lineId: line.id, tokenIndex: 1, alternative: 9 }), /no such word/i);
  });

  it("removes a word with its cards and examples", async () => {
    const word = save(await play("Die Häusern sind gut."), "Häusern");
    bank.remove(word.id);
    assert.equal(bank.list().length, 0);
    assert.equal((db.db.prepare("SELECT count(*) AS n FROM cards").get() as { n: number }).n, 0);
    assert.throws(() => bank.remove(word.id), /No such word/);
  });
});

describe("reviewing", () => {
  it("shows one new card per word a day, meaning first", async () => {
    save(await play("Die Häusern sind gut."), "Häusern");
    const q = bank.queue(T0);
    assert.deepEqual(q.items.map((i) => i.card.kind), ["meaning"]);
    assert.equal(q.items[0]?.word.lemma, "Haus");
    assert.deepEqual(q.items[0]?.intervals, { 1: "1 min", 2: "6 min", 3: "10 min", 4: "8 days" });
  });

  it("counts only the new cards that can come up today", async () => {
    save(await play("Die Häusern sind gut."), "Häusern"); // meaning + article, one a day
    save(await play("Ich bin gut."), "gut");
    const q = bank.queue(T0);
    assert.equal(q.newAvailable, 2);
    assert.equal(bank.stats(T0).dueNow, 2);
  });

  it("undoes the last answer: the card and the log go back as they were", async () => {
    save(await play("Ich bin gut."), "gut");
    assert.equal(bank.queue(T0).canUndo, false);
    assert.throws(() => bank.undo(), /Nothing to undo/);
    const before = bank.queue(T0).items[0]!.card;
    bank.answer(before.id, 3, undefined, T0);
    const second = bank.answer(before.id, 1, undefined, T0 + 10 * MIN);
    assert.equal(bank.queue(T0 + 10 * MIN).canUndo, true);
    assert.equal(bank.stats(T0 + 10 * MIN).reviewedToday, 2);
    // back one step: where it was after the first answer
    const undone = bank.undo();
    assert.equal(undone.due, T0 + 10 * MIN);
    assert.equal(undone.state, "learning");
    assert.equal(undone.reps, 1);
    assert.equal(bank.stats(T0 + 10 * MIN).reviewedToday, 1);
    assert.notEqual(second.reps, undone.reps);
    // and back to the start: a new card again
    const fresh = bank.undo();
    assert.deepEqual({ ...fresh }, { ...before });
    assert.equal(bank.queue(T0).canUndo, false);
  });

  it("schedules answers with FSRS and brings learning cards back", async () => {
    save(await play("Ich bin gut."), "gut");
    const card = bank.queue(T0).items[0]!.card;
    const after = bank.answer(card.id, 3, 1200, T0);
    assert.equal(after.state, "learning");
    assert.equal(after.due, T0 + 10 * MIN);
    // not due yet, but nothing else to do: shown early (learn ahead)
    assert.equal(bank.queue(T0 + MIN).items[0]?.card.id, card.id);
    const graduated = bank.answer(card.id, 3, undefined, T0 + 10 * MIN);
    assert.equal(graduated.state, "review");
    assert.ok(graduated.due > T0 + DAY);
    const later = bank.queue(T0 + 11 * MIN);
    assert.equal(later.items.length, 0);
    assert.equal(later.nextDue, graduated.due);
  });

  it("limits new cards per day", async () => {
    bank.updateSettings({ newPerDay: 1 });
    save(await play("Ich bin gut."), "gut");
    save(await play("Ich ruhe."), "ruhe");
    const first = bank.queue(T0).items;
    assert.equal(first.length, 1);
    bank.answer(first[0]!.card.id, 4, undefined, T0);
    const q = bank.queue(T0 + MIN);
    assert.equal(q.items.length, 0);
    assert.equal(q.nextDue, dayStart(T0) + DAY, "the next new card waits for tomorrow");
    assert.equal(bank.queue(dayStart(T0) + DAY + MIN).items.length, 1);
  });

  it("adds recall cards when the setting is turned on", async () => {
    const word = save(await play("Ich bin gut."), "gut");
    bank.updateSettings({ recallCards: true });
    assert.deepEqual(bank.get(word.id)!.cards.map((c) => c.kind), ["meaning", "recall"]);
    bank.updateSettings({ recallCards: false });
    assert.deepEqual(bank.get(word.id)!.cards.map((c) => c.kind), ["meaning"], "hidden, not deleted");
    assert.throws(() => bank.updateSettings({ newPerDay: -1 }), /newPerDay/);
  });

  it("reports retention over the last 30 days", async () => {
    save(await play("Ich bin gut."), "gut");
    const id = bank.queue(T0).items[0]!.card.id;
    bank.answer(id, 3, undefined, T0);
    bank.answer(id, 3, undefined, T0 + 10 * MIN); // graduates
    let s = bank.stats(T0 + 11 * MIN);
    assert.equal(s.retention30d, null, "learning answers don't count");
    assert.equal(s.reviewedToday, 2);
    const due = bank.get(bank.list()[0]!.id)!.cards[0]!.due;
    bank.answer(id, 1, undefined, due); // forgot it
    s = bank.stats(due);
    assert.equal(s.retention30d, 0);
    assert.equal(s.reviews30d, 1);
    assert.equal(s.words, 1);
  });
});

describe("formatInterval", () => {
  it("rounds to readable units", () => {
    assert.deepEqual([30_000, 10 * MIN, 3 * 60 * MIN, DAY, 4 * DAY, 60 * DAY, 400 * DAY].map(formatInterval),
      ["1 min", "10 min", "3 h", "1 day", "4 days", "2 mo", "1.1 yr"]);
  });

  it("doesn't save words from Spanish games yet", async () => {
    const line = (await pipeline.submit({ ...msg("Das Haus"), game: "pokemon-emerald-es", lang: "es" }))!;
    assert.throws(() => bank.save({ lineId: line.id, tokenIndex: 0 }, T0), /Spanish/);
  });
});
