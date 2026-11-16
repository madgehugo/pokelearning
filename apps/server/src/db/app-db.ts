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

  /** Lines with their analysis and translation, newest first. */
  recentLines(limit: number, beforeId?: number): ProcessedLine[] {
    const rows = this.db
      .prepare(
        `SELECT l.id, l.game, l.source, l.lang, l.text, l.received_at, l.translation, l.translation_provider,
                a.analysis
         FROM lines l LEFT JOIN line_analyses a ON a.line_id = l.id
         WHERE (? IS NULL OR l.id < ?)
         ORDER BY l.id DESC LIMIT ?`,
      )
      .all(beforeId ?? null, beforeId ?? null, limit) as unknown as LineRow[];
    return rows.map((r) => ({
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
    }));
  }

  close(): void {
    this.db.close();
  }
}
