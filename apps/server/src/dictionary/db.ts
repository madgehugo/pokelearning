/**
 * The dictionary database (data/dictionary.db): lexemes and their inflected
 * forms, built from Kaikki by scripts/import-dictionary.ts. Read-only at runtime.
 */
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { ConvertedEntry, LexemeRow } from "./kaikki.ts";

export const DICTIONARY_SCHEMA = `
CREATE TABLE lexemes (
  id       INTEGER PRIMARY KEY,
  lemma    TEXT NOT NULL,
  pos      TEXT NOT NULL,
  gender   TEXT,
  plural   TEXT,
  senses   TEXT NOT NULL,  -- JSON [{ gloss, tags? }]
  particle TEXT            -- separable verb prefix
);
CREATE TABLE forms (
  form_lc   TEXT NOT NULL,
  form      TEXT NOT NULL,
  lexeme_id INTEGER NOT NULL REFERENCES lexemes(id),
  tags      TEXT,
  particle  TEXT,          -- set if this form needs a detached particle
  direct    INTEGER NOT NULL DEFAULT 0  -- 1 if the word's own entry says it is a form of this lexeme
);
CREATE TABLE pending_forms (form TEXT, lemma TEXT, pos TEXT, tags TEXT);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
`;

/** Indexes are created after the bulk insert, which is much faster. */
const DICTIONARY_INDEXES = `
CREATE INDEX lexemes_lemma_pos ON lexemes(lemma, pos);
CREATE INDEX forms_form_lc ON forms(form_lc);
`;

/** Writes converted entries into a fresh dictionary database. */
export class DictionaryBuilder {
  readonly db: DatabaseSync;
  private insertLexeme;
  private insertForm;
  private insertPending;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;");
    this.db.exec(DICTIONARY_SCHEMA);
    this.insertLexeme = this.db.prepare(
      "INSERT INTO lexemes (lemma, pos, gender, plural, senses, particle) VALUES (?, ?, ?, ?, ?, ?)",
    );
    this.insertForm = this.db.prepare(
      "INSERT INTO forms (form_lc, form, lexeme_id, tags, particle) VALUES (?, ?, ?, ?, ?)",
    );
    this.insertPending = this.db.prepare("INSERT INTO pending_forms (form, lemma, pos, tags) VALUES (?, ?, ?, ?)");
    this.db.exec("BEGIN");
  }

  add(entry: ConvertedEntry): void {
    if (entry.lexeme) {
      const l = entry.lexeme;
      const { lastInsertRowid } = this.insertLexeme.run(
        l.lemma, l.pos, l.gender, l.plural, JSON.stringify(l.senses), l.particle,
      );
      for (const f of entry.forms) {
        this.insertForm.run(f.form.toLowerCase(), f.form, lastInsertRowid, f.tags, f.particle);
      }
    }
    for (const p of entry.pending) this.insertPending.run(p.form, p.lemma, p.pos, p.tags);
  }

  /** Resolve form-of entries, build indexes, record the version. Returns row counts. */
  finish(version: string): { lexemes: number; forms: number } {
    this.db.exec("COMMIT");
    this.db.exec(DICTIONARY_INDEXES);
    // "bin" (verb form of sein) → every verb lexeme "sein"; fall back to any pos.
    this.db.exec(`
      INSERT INTO forms (form_lc, form, lexeme_id, tags, particle, direct)
        SELECT lower(p.form), p.form, l.id, p.tags, NULL, 1
        FROM pending_forms p JOIN lexemes l ON l.lemma = p.lemma AND l.pos = p.pos;
      INSERT INTO forms (form_lc, form, lexeme_id, tags, particle, direct)
        SELECT lower(p.form), p.form, l.id, p.tags, NULL, 1
        FROM pending_forms p JOIN lexemes l ON l.lemma = p.lemma
        WHERE NOT EXISTS (SELECT 1 FROM lexemes x WHERE x.lemma = p.lemma AND x.pos = p.pos);
      DROP TABLE pending_forms;
    `);
    this.db.prepare("INSERT INTO meta (key, value) VALUES ('version', ?)").run(version);
    const count = (t: string) => (this.db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
    const counts = { lexemes: count("lexemes"), forms: count("forms") };
    this.db.exec("VACUUM");
    this.db.close();
    return counts;
  }
}

export interface FormMatch {
  /** The stored spelling of the form, e.g. "Häusern". */
  form: string;
  formTags: string | null;
  /** Set if this reading needs a detached particle later in the clause. */
  formParticle: string | null;
  /** The word's own entry names this lexeme ("dich: accusative of du"). */
  direct: boolean;
  lexemeId: number;
  lexeme: LexemeRow;
}

interface FormMatchRow {
  form: string;
  tags: string | null;
  form_particle: string | null;
  direct: number;
  id: number;
  lemma: string;
  pos: string;
  gender: string | null;
  plural: string | null;
  senses: string;
  particle: string | null;
}

export interface Dictionary {
  version: string | null;
  /** All readings of a word form, matched case-insensitively. */
  lookup(form: string): FormMatch[];
  close(): void;
}

export function openDictionary(file: string): Dictionary | null {
  if (!fs.existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true });
  const version = (db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as { value: string } | undefined)?.value ?? null;
  const query = db.prepare(`
    SELECT f.form, f.tags, f.particle AS form_particle, f.direct,
           l.id, l.lemma, l.pos, l.gender, l.plural, l.senses, l.particle
    FROM forms f JOIN lexemes l ON l.id = f.lexeme_id
    WHERE f.form_lc = ?
    LIMIT 60
  `);
  const cache = new Map<string, FormMatch[]>();
  return {
    version,
    lookup(form) {
      const key = form.toLowerCase();
      const hit = cache.get(key);
      if (hit) return hit;
      const rows = query.all(key) as unknown as FormMatchRow[];
      const matches = rows.map((r) => ({
        form: r.form,
        formTags: r.tags,
        formParticle: r.form_particle,
        direct: r.direct === 1,
        lexemeId: r.id,
        lexeme: {
          lemma: r.lemma,
          pos: r.pos,
          gender: r.gender,
          plural: r.plural,
          senses: JSON.parse(r.senses),
          particle: r.particle,
        },
      }));
      if (cache.size > 20_000) cache.clear();
      cache.set(key, matches);
      return matches;
    },
    close: () => db.close(),
  };
}
