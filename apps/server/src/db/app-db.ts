/**
 * The app database (data/app.db): your own data. Received lines with their
 * analysis and translation, and the translation cache. Phase 4 adds the word
 * bank and review state here.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { LineAnalysis, LineMessage, ProcessedLine } from "@pokelearning/shared";

interface LineRow {
  id: number;
  game: string;
  source: string | null;
  lang: string | null;
  text: string;
  received_at: number;
  translation: string | null;
  translation_provider: string | null;
  analysis: string | null;
  seen_before: number;
}

/** Each entry upgrades the schema by one version (PRAGMA user_version). Never edit old entries. */
const MIGRATIONS = [
  `
  CREATE TABLE lines (
    id                   INTEGER PRIMARY KEY,
    game                 TEXT NOT NULL,
    adapter              TEXT NOT NULL,
    source               TEXT,
    lang                 TEXT,
    text                 TEXT NOT NULL,
    adapter_ts           INTEGER NOT NULL,
    received_at          INTEGER NOT NULL,
    meta                 TEXT,
    translation          TEXT,
    translation_provider TEXT
  );
  CREATE INDEX lines_received_at ON lines(received_at);
  CREATE INDEX lines_text ON lines(text);

  CREATE TABLE line_analyses (
    line_id            INTEGER PRIMARY KEY REFERENCES lines(id) ON DELETE CASCADE,
    dictionary_version TEXT,
    analysis           TEXT NOT NULL,
    created_at         INTEGER NOT NULL
  );

  CREATE TABLE translation_cache (
    provider    TEXT NOT NULL,
    source_lang TEXT NOT NULL,
    target_lang TEXT NOT NULL,
    source_text TEXT NOT NULL,
    translation TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (provider, source_lang, target_lang, source_text)
  );
  `,
  // 2: word bank and FSRS review
  `
  CREATE TABLE words (
    id           INTEGER PRIMARY KEY,
    lemma        TEXT NOT NULL,
    pos          TEXT NOT NULL,
    gender       TEXT,
    plural       TEXT,
    glosses      TEXT NOT NULL,   -- JSON string[]
    source       TEXT NOT NULL,   -- dictionary | glossary
    created_at   INTEGER NOT NULL,
    encounters   INTEGER NOT NULL DEFAULT 0,
    last_seen_at INTEGER,
    UNIQUE (lemma, pos)
  );

  CREATE TABLE word_contexts (
    id         INTEGER PRIMARY KEY,
    word_id    INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    line_id    INTEGER NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
    form       TEXT NOT NULL,
    start      INTEGER NOT NULL,
    end        INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX word_contexts_word ON word_contexts(word_id);

  CREATE TABLE cards (
    id             INTEGER PRIMARY KEY,
    word_id        INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
    kind           TEXT NOT NULL,      -- meaning | article | recall
    due            INTEGER NOT NULL,   -- epoch ms
    stability      REAL NOT NULL,
    difficulty     REAL NOT NULL,
    scheduled_days INTEGER NOT NULL,
    learning_steps INTEGER NOT NULL,
    reps           INTEGER NOT NULL,
    lapses         INTEGER NOT NULL,
    state          INTEGER NOT NULL,   -- ts-fsrs State: 0 new, 1 learning, 2 review, 3 relearning
    last_review    INTEGER,
    created_at     INTEGER NOT NULL,
    UNIQUE (word_id, kind)
  );
  CREATE INDEX cards_due ON cards(due);

  CREATE TABLE review_log (
    id             INTEGER PRIMARY KEY,
    card_id        INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    grade          INTEGER NOT NULL,
    state          INTEGER NOT NULL,   -- state before the answer
    due            INTEGER NOT NULL,
    stability      REAL NOT NULL,
    difficulty     REAL NOT NULL,
    scheduled_days INTEGER NOT NULL,
    learning_steps INTEGER NOT NULL,
    review         INTEGER NOT NULL,   -- when it was answered, epoch ms
    duration_ms    INTEGER
  );
  CREATE INDEX review_log_review ON review_log(review);

  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  // 3: mini-game results (kept apart from FSRS reviews)
  `
  CREATE TABLE game_results (
    id          INTEGER PRIMARY KEY,
    kind        TEXT NOT NULL,     -- articles | cloze | listening | matching
    score       INTEGER NOT NULL,
    total       INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    mistakes    INTEGER NOT NULL,
    played_at   INTEGER NOT NULL
  );
  CREATE INDEX game_results_kind ON game_results(kind, played_at);
  `,
];

const LINE_SELECT = `
  SELECT l.id, l.game, l.source, l.lang, l.text, l.received_at, l.translation, l.translation_provider,
         a.analysis,
         (SELECT count(*) FROM lines e WHERE e.game = l.game AND e.text = l.text AND e.id < l.id) AS seen_before
  FROM lines l LEFT JOIN line_analyses a ON a.line_id = l.id`;

function toProcessedLine(r: LineRow): ProcessedLine {
  return {
    id: r.id,
    game: r.game,
    ...(r.source ? { source: r.source } : {}),
    ...(r.lang ? { lang: r.lang } : {}),
    text: r.text,
    receivedAt: r.received_at,
    analysis: r.analysis ? (JSON.parse(r.analysis) as LineAnalysis) : null,
    translation:
      r.translation && r.translation_provider
        ? { provider: r.translation_provider, from: r.lang ?? "de", to: "en", text: r.translation, cached: true }
        : null,
    seenBefore: r.seen_before,
  };
}

export class AppDb {
  readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    const { user_version: current } = this.db.prepare("PRAGMA user_version").get() as { user_version: number };
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.db.exec("BEGIN");
      this.db.exec(MIGRATIONS[v]!);
      this.db.exec(`PRAGMA user_version = ${v + 1}`);
      this.db.exec("COMMIT");
    }
  }

  insertLine(msg: LineMessage, receivedAt: number): number {
    const { lastInsertRowid } = this.db
      .prepare(
        `INSERT INTO lines (game, adapter, source, lang, text, adapter_ts, received_at, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        msg.game,
        msg.adapter,
        msg.meta?.source ?? null,
        msg.lang ?? null,
        msg.line,
        msg.timestamp,
        receivedAt,
        msg.meta ? JSON.stringify(msg.meta) : null,
      );
    return Number(lastInsertRowid);
  }

  /** Earlier lines with the same text in the same game. */
  countEarlier(game: string, text: string, beforeId: number): number {
    const row = this.db
      .prepare("SELECT count(*) AS n FROM lines WHERE game = ? AND text = ? AND id < ?")
      .get(game, text, beforeId) as { n: number };
    return row.n;
  }

  saveAnalysis(lineId: number, analysis: LineAnalysis): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO line_analyses (line_id, dictionary_version, analysis, created_at) VALUES (?, ?, ?, ?)`,
      )
      .run(lineId, analysis.dictionaryVersion, JSON.stringify(analysis), Date.now());
  }

  saveLineTranslation(lineId: number, provider: string, translation: string): void {
    this.db.prepare("UPDATE lines SET translation = ?, translation_provider = ? WHERE id = ?").run(translation, provider, lineId);
  }

  getCachedTranslation(provider: string, from: string, to: string, text: string): string | undefined {
    const row = this.db
      .prepare(
        `SELECT translation FROM translation_cache
         WHERE provider = ? AND source_lang = ? AND target_lang = ? AND source_text = ?`,
      )
      .get(provider, from, to, text) as { translation: string } | undefined;
    return row?.translation;
  }

  cacheTranslation(provider: string, from: string, to: string, text: string, translation: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO translation_cache (provider, source_lang, target_lang, source_text, translation, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(provider, from, to, text, translation, Date.now());
  }

  /** Lines with their analysis and translation, newest first. */
  recentLines(limit: number, beforeId?: number): ProcessedLine[] {
    const rows = this.db
      .prepare(`${LINE_SELECT} WHERE (? IS NULL OR l.id < ?) ORDER BY l.id DESC LIMIT ?`)
      .all(beforeId ?? null, beforeId ?? null, limit) as unknown as LineRow[];
    return rows.map(toProcessedLine);
  }

  getLine(id: number): ProcessedLine | undefined {
    const row = this.db.prepare(`${LINE_SELECT} WHERE l.id = ?`).get(id) as unknown as LineRow | undefined;
    return row ? toProcessedLine(row) : undefined;
  }

  /** A consistent copy of the database, safe while the server runs (VACUUM INTO). */
  backupTo(file: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.rmSync(file, { force: true });
    this.db.prepare("VACUUM INTO ?").run(file);
  }

  close(): void {
    this.db.close();
  }
}
