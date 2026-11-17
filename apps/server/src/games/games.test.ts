import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { LineMessage } from "@pokelearning/shared";
import { AppDb } from "../db/app-db.ts";
import { createGlossary } from "../language/glossary.ts";
import { LinePipeline } from "../pipeline.ts";
import { fixtureDictionary } from "../test-fixtures.ts";
import type { TranslationProvider } from "../translate/provider.ts";
import { Translator } from "../translate/translator.ts";
import { Scheduler } from "../wordbank/scheduler.ts";
import { WordBank } from "../wordbank/wordbank.ts";
import { Games, MATCHING_PENALTY_MS } from "./games.ts";

const dictionary = fixtureDictionary();
const glossary = createGlossary([]);

/** Deterministic random numbers (mulberry32), so rounds are reproducible. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const english: TranslationProvider = {
  id: "fake",
  supports: (from, to) => from === "de" && to === "en",
  warmUp: async () => {},
  translate: async (text: string) => `EN: ${text}`,
};

const LINES = [
  "Das Haus ist gut und die Ruhe ist gut.",
  "Ich warte auf die Glut im Haus.",
  "Der Trank ist im Haus und der Ball ist gut.",
  "Ich ruhe mich im Haus aus und warte.",
  "Die Glut ist gut, der Ball ist gut.",
  "Ruh dich gut aus, die Ruhe ist gut!",
  "Das Center hat Ruhe und einen Trank.",
  "Ich bin gut, das Haus ist gut.",
];

let db: AppDb;
let bank: WordBank;
let games: Games;

async function play(lines = LINES) {
  const pipeline = new LinePipeline(db, { dictionary, glossary }, new Translator(english, db, glossary), "en");
  const out = [];
  for (const line of lines) {
    const msg: LineMessage = { type: "line", adapter: "t", game: "g", lang: "de", line, timestamp: 0 };
    out.push((await pipeline.submit(msg))!);
  }
  return out;
}

beforeEach(() => {
  db = new AppDb(":memory:");
  bank = new WordBank(db, new Scheduler({ fuzz: false }));
  games = new Games(db, bank, seeded(42));
});

describe("game material", () => {
  it("article sprint uses nouns from your lines, saved words first", async () => {
    const lines = await play();
    const ball = lines[2]!;
    bank.save({ lineId: ball.id, tokenIndex: ball.analysis!.tokens.findIndex((t) => t.text === "Ball") });
    const m = games.material("articles");
    assert.equal(m.kind, "articles");
    if (m.kind !== "articles") return;
    assert.equal(m.items[0]?.lemma, "Ball", "saved word first");
    assert.equal(m.items[0]?.saved, true);
    const byLemma = Object.fromEntries(m.items.map((i) => [i.lemma, i.article]));
    assert.deepEqual(byLemma, { Ball: "der", Haus: "das", Ruhe: "die", Glut: "die", Trank: "der", Center: "das" });
    const haus = m.items.find((i) => i.lemma === "Haus")!;
    assert.equal(haus.example!.text.slice(haus.example!.start, haus.example!.end), "Haus");
  });

  it("fill the gap blanks a content word and offers it among distinct options", async () => {
    await play();
    const m = games.material("cloze");
    assert.ok(m.kind === "cloze" && m.rounds.length >= 4);
    if (m.kind !== "cloze") return;
    for (const r of m.rounds) {
      assert.equal(r.text.slice(r.start, r.end), r.answer);
      assert.equal(r.options.length, 4);
      assert.equal(new Set(r.options.map((o) => o.toLowerCase())).size, 4, "no duplicate options");
      assert.ok(r.options.includes(r.answer));
      assert.ok(r.translation?.startsWith("EN: "));
    }
  });

  it("listening offers the line's own translation among others", async () => {
    await play();
    const m = games.material("listening");
    assert.ok(m.kind === "listening" && m.rounds.length >= 4);
    if (m.kind !== "listening") return;
    for (const r of m.rounds) {
      assert.equal(r.answer, `EN: ${r.text}`);
      assert.equal(new Set(r.options).size, 4);
      assert.ok(r.options.includes(r.answer));
    }
  });

  it("matching pairs German words with distinct meanings, nouns with their article", async () => {
    await play();
    const m = games.material("matching");
    assert.ok(m.kind === "matching");
    if (m.kind !== "matching") return;
    assert.equal(m.pairs.length, 6);
    assert.equal(new Set(m.pairs.map((p) => p.english)).size, 6);
    assert.ok(m.pairs.some((p) => p.word === "das Haus" && p.english === "house"));
    assert.ok(!m.pairs.some((p) => p.word.toLowerCase().endsWith(p.english.toLowerCase())), "no word paired with itself");
  });

  it("says how much material there is", async () => {
    await play(LINES.slice(0, 2));
    const a = Object.fromEntries(games.availability().map((x) => [x.kind, x]));
    assert.equal(a.listening?.available, 0, "needs four lines with translations");
    assert.equal(a.listening?.needed, 4);
    assert.ok(a.articles!.available > 0);
  });
});

describe("game results", () => {
  it("keeps the best score and says when it's new", () => {
    assert.equal(games.saveResult({ kind: "articles", score: 12, total: 15, durationMs: 60_000, mistakes: 3 }, 1).newBest, true);
    assert.equal(games.saveResult({ kind: "articles", score: 9, total: 12, durationMs: 60_000, mistakes: 3 }, 2).newBest, false);
    const r = games.saveResult({ kind: "articles", score: 14, total: 16, durationMs: 60_000, mistakes: 2 }, 3);
    assert.deepEqual([r.newBest, r.record.best, r.record.plays, r.record.last?.score], [true, 14, 3, 14]);
  });

  it("matching counts time, with a penalty for wrong taps", () => {
    games.saveResult({ kind: "matching", score: 6, total: 6, durationMs: 20_000, mistakes: 0 }, 1);
    const slower = games.saveResult({ kind: "matching", score: 6, total: 6, durationMs: 15_000, mistakes: 2 }, 2);
    assert.equal(slower.newBest, false, "15 s + 2 × 3 s is slower than 20 s");
    const faster = games.saveResult({ kind: "matching", score: 6, total: 6, durationMs: 12_000, mistakes: 1 }, 3);
    assert.deepEqual([faster.newBest, faster.record.best], [true, 12_000 + MATCHING_PENALTY_MS]);
  });

  it("rejects nonsense", () => {
    assert.throws(() => games.saveResult({ kind: "chess" as never, score: 1, total: 1, durationMs: 1, mistakes: 0 }), /unknown game/);
    assert.throws(() => games.saveResult({ kind: "cloze", score: 5, total: 4, durationMs: 1, mistakes: 0 }), /higher than total/);
    assert.throws(() => games.saveResult({ kind: "cloze", score: -1, total: 4, durationMs: 1, mistakes: 0 }), /whole number/);
  });
});
