import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { AppDb, MIGRATIONS } from "./app-db.ts";

describe("migration 6 (a language on words)", () => {
  it("keeps saved words, cards, examples and hidden words, and backs the file up first", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pokelearning-mig-"));
    const file = path.join(dir, "app.db");
    const old = new DatabaseSync(file);
    old.exec("PRAGMA foreign_keys = ON");
    for (const sql of MIGRATIONS.slice(0, 5)) old.exec(sql);
    old.exec("PRAGMA user_version = 5");
    old.exec(`
      INSERT INTO lines (id, game, adapter, text, adapter_ts, received_at) VALUES (1, 'g', 'a', 'Das Haus', 0, 0);
      INSERT INTO words (id, lemma, pos, gender, glosses, source, created_at) VALUES (7, 'Haus', 'noun', 'n', '["house"]', 'dictionary', 1);
      INSERT INTO word_contexts (word_id, line_id, form, start, end, created_at) VALUES (7, 1, 'Haus', 4, 8, 1);
      INSERT INTO cards (word_id, kind, due, stability, difficulty, scheduled_days, learning_steps, reps, lapses, state, created_at)
        VALUES (7, 'meaning', 1, 1, 1, 0, 0, 3, 0, 2, 1);
      INSERT INTO review_log (card_id, grade, state, due, stability, difficulty, scheduled_days, learning_steps, review)
        VALUES (1, 3, 2, 1, 1, 1, 0, 0, 5);
      INSERT INTO hidden_words (lemma, pos, gloss, hidden_at) VALUES ('AAa', 'unknown', '', 1);
    `);
    old.close();

    const app = new AppDb(file);
    const n = (table: string) => (app.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
    assert.deepEqual(["words", "cards", "word_contexts", "review_log", "hidden_words"].map(n), [1, 1, 1, 1, 1]);
    assert.deepEqual(app.db.prepare("SELECT id, lang FROM words").all().map((r) => ({ ...r })), [{ id: 7, lang: "de" }]);
    assert.equal((app.db.prepare("SELECT reps FROM cards WHERE word_id = 7").get() as { reps: number }).reps, 3);
    assert.equal((app.db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys, 1);
    assert.ok(fs.existsSync(`${file}.before-v6`));
    // the same word in Spanish is now allowed next to the German one
    app.db.prepare("INSERT INTO words (lemma, pos, lang, glosses, source, created_at) VALUES ('Haus', 'noun', 'es', '[]', 'dictionary', 2)").run();
    app.close();
  });
});
