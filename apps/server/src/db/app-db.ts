/**
 * The app database (data/app.db): your own data. Received lines with their
 * analysis and translation, and the translation cache. Phase 4 adds the word
 * bank and review state here.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { LineAnalysis, LineMessage } from "@pokelearning/shared";

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
];

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

  close(): void {
    this.db.close();
  }
}
