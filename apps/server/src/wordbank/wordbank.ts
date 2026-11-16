/**
 * The word bank: words you saved from the game, the sentences they came up
 * in, and their FSRS review cards.
 *
 * Saving a word creates a "meaning" card, an "article" card for nouns with a
 * single gender, and a "recall" card if that setting is on. Every new line
 * from the game that uses a saved word counts as an encounter and may add an
 * example sentence.
 */
import type { DatabaseSync } from "node:sqlite";
import {
  wordKey,
  type CardKind,
  type CardSummary,
  type Grade,
  type HiddenWord,
  type ProcessedLine,
  type ReviewItem,
  type ReviewQueue,
  type SavedWord,
  type SaveWordRequest,
  type Settings,
  type TokenAnalysis,
  type WordBankStats,
  type WordContext,
  type WordSense,
} from "@pokelearning/shared";
import type { AppDb } from "../db/app-db.ts";
import { articlesFor } from "../language/glossary.ts";
import { STATE_NAMES, STATE_NEW, STATE_REVIEW, type CardFields, type Scheduler } from "./scheduler.ts";

const MAX_CONTEXTS = 5;
const QUEUE_SIZE = 20;
/** When nothing else is due, learning cards due within this window are shown early. */
const LEARN_AHEAD_MS = 20 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
/** A new day starts at 4:00 local time, so late-night sessions count as the same day. */
const DAY_START_HOUR = 4;

export const DEFAULT_SETTINGS: Settings = { newPerDay: 20, recallCards: false };

export class WordBankError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function dayStart(now: number): number {
  const d = new Date(now);
  d.setHours(DAY_START_HOUR, 0, 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}

interface WordRow {
  id: number;
  lemma: string;
  pos: string;
  gender: string | null;
  plural: string | null;
  glosses: string;
  created_at: number;
  encounters: number;
  last_seen_at: number | null;
}

/** Just the scheduling columns of a card row. */
function schedulingFields(c: CardFields): CardFields {
  return {
    due: c.due, stability: c.stability, difficulty: c.difficulty, scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps, reps: c.reps, lapses: c.lapses, state: c.state, last_review: c.last_review,
  };
}

interface CardRow extends CardFields {
  id: number;
  word_id: number;
  kind: CardKind;
  created_at: number;
}

interface ContextRow {
  word_id: number;
  line_id: number;
  form: string;
  start: number;
  end: number;
  created_at: number;
  text: string;
  translation: string | null;
}

/** The token (or compound part) in a line whose best reading is this word. */
function findWord(tokens: TokenAnalysis[], lemma: string, pos: string): TokenAnalysis | undefined {
  let particle: TokenAnalysis | undefined;
  for (const t of tokens) {
    for (const candidate of [t, ...(t.parts ?? [])]) {
      const b = candidate.best;
      if (!b || b.lemma !== lemma || b.pos !== pos) continue;
      // prefer the verb itself over its separated prefix ("Ruh" over "aus")
      if (b.formTags === "separated prefix") particle ??= candidate;
      else return candidate;
    }
  }
  return particle;
}

function cardKinds(sense: Pick<WordSense, "pos" | "articles">, settings: Settings): CardKind[] {
  const kinds: CardKind[] = ["meaning"];
  if ((sense.pos === "noun" || sense.pos === "item") && sense.articles?.length === 1) kinds.push("article");
  if (settings.recallCards) kinds.push("recall");
  return kinds;
}

export class WordBank {
  private readonly db: DatabaseSync;

  constructor(
    private readonly app: AppDb,
    private readonly scheduler: Scheduler,
  ) {
    this.db = app.db;
  }

  // Settings ---------------------------------------------------------------

  settings(): Settings {
    const rows = this.db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
    const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
    return { ...DEFAULT_SETTINGS, ...stored };
  }

  updateSettings(patch: Partial<Settings>, now = Date.now()): Settings {
    const next = { ...this.settings() };
    if (patch.newPerDay !== undefined) {
      if (!Number.isInteger(patch.newPerDay) || patch.newPerDay < 0 || patch.newPerDay > 500) {
        throw new WordBankError("newPerDay must be a whole number from 0 to 500");
      }
      next.newPerDay = patch.newPerDay;
    }
    if (patch.recallCards !== undefined) next.recallCards = !!patch.recallCards;
    const put = this.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
    for (const [k, v] of Object.entries(next)) put.run(k, JSON.stringify(v));
    // Turning recall on gives existing words their recall card; turning it off only hides them.
    if (next.recallCards) {
      for (const { id } of this.db.prepare("SELECT id FROM words").all() as { id: number }[]) {
        this.createCard(id, "recall", now);
      }
    }
    return next;
  }

  private enabledKinds(): CardKind[] {
    return this.settings().recallCards ? ["meaning", "article", "recall"] : ["meaning", "article"];
  }

  // Words ------------------------------------------------------------------

  private createCard(wordId: number, kind: CardKind, now: number): void {
    const c = this.scheduler.newCard(now);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO cards (word_id, kind, due, stability, difficulty, scheduled_days, learning_steps,
                                      reps, lapses, state, last_review, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(wordId, kind, c.due, c.stability, c.difficulty, c.scheduled_days, c.learning_steps, c.reps, c.lapses,
        c.state, c.last_review, now);
  }

  private addContext(wordId: number, line: ProcessedLine, token: TokenAnalysis, now: number): boolean {
    // one example per distinct sentence, newest kept
    const dup = this.db
      .prepare(
        `SELECT 1 FROM word_contexts c JOIN lines l ON l.id = c.line_id WHERE c.word_id = ? AND l.text = ?`,
      )
      .get(wordId, line.text);
    if (dup) return false;
    const end = token.phraseEnd ?? token.end; // a multi-word name is highlighted as a whole
    this.db
      .prepare("INSERT INTO word_contexts (word_id, line_id, form, start, end, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(wordId, line.id, line.text.slice(token.start, end), token.start, end, now);
    this.db
      .prepare(
        `DELETE FROM word_contexts WHERE word_id = ? AND id NOT IN
           (SELECT id FROM word_contexts WHERE word_id = ? ORDER BY created_at DESC, id DESC LIMIT ?)`,
      )
      .run(wordId, wordId, MAX_CONTEXTS);
    return true;
  }

  /** Save the reading of a word from a stored line. Saving an already saved word adds the example. */
  save(req: SaveWordRequest, now = Date.now()): SavedWord {
    const line = this.app.getLine(req.lineId);
    const tokens = line?.analysis?.tokens;
    if (!line || !tokens) throw new WordBankError("That line isn't stored or has no word breakdown", 404);
    let token = tokens[req.tokenIndex];
    if (token && req.part !== undefined) token = token.parts?.[req.part];
    const sense = token && (req.alternative !== undefined ? token.alternatives?.[req.alternative] : token.best);
    if (!token || !sense) throw new WordBankError("There is no such word reading in that line", 404);

    this.db.exec("BEGIN");
    try {
      const { changes } = this.db
        .prepare(
          `INSERT INTO words (lemma, pos, gender, plural, glosses, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (lemma, pos) DO NOTHING`,
        )
        .run(sense.lemma, sense.pos, sense.gender ?? null, sense.plural ?? null, JSON.stringify(sense.glosses),
          sense.source, now);
      const isNew = changes > 0;
      const { id } = this.db
        .prepare("SELECT id FROM words WHERE lemma = ? AND pos = ?")
        .get(sense.lemma, sense.pos) as { id: number };
      this.unhide(sense.lemma, sense.pos); // saving a word means you want to see it
      for (const kind of cardKinds(sense, this.settings())) this.createCard(id, kind, now);
      if (isNew) this.backfill(id, sense.lemma, sense.pos, now);
      this.addContext(id, line, token, now);
      this.db.exec("COMMIT");
      return this.get(id)!;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /** Count earlier lines that used the word, and take the latest as examples. */
  private backfill(wordId: number, lemma: string, pos: string, now: number): void {
    const like = `%"lemma":${JSON.stringify(lemma).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = this.db
      .prepare(
        `SELECT a.line_id FROM line_analyses a WHERE a.analysis LIKE ? ESCAPE '\\' ORDER BY a.line_id DESC`,
      )
      .all(like) as { line_id: number }[];
    let encounters = 0;
    let lastSeen: number | null = null;
    const examples: { line: ProcessedLine; token: TokenAnalysis }[] = [];
    for (const { line_id } of rows) {
      const line = this.app.getLine(line_id);
      const token = line?.analysis && findWord(line.analysis.tokens, lemma, pos);
      if (!line || !token) continue;
      encounters++;
      lastSeen ??= line.receivedAt;
      if (examples.length < MAX_CONTEXTS && !examples.some((e) => e.line.text === line.text)) {
        examples.push({ line, token });
      }
    }
    this.db.prepare("UPDATE words SET encounters = ?, last_seen_at = ? WHERE id = ?").run(encounters, lastSeen, wordId);
    for (const e of examples.reverse()) this.addContext(wordId, e.line, e.token, e.line.receivedAt);
  }

  /** A new line from the game: count encounters of saved words and keep examples. */
  recordLine(line: ProcessedLine): boolean {
    if (!line.analysis) return false;
    const find = this.db.prepare("SELECT id FROM words WHERE lemma = ? AND pos = ?");
    const seen = new Set<number>();
    for (const t of line.analysis.tokens) {
      for (const candidate of [t, ...(t.parts ?? [])]) {
        const b = candidate.best;
        if (!b) continue;
        const row = find.get(b.lemma, b.pos) as { id: number } | undefined;
        if (!row || seen.has(row.id)) continue;
        seen.add(row.id);
        const token = findWord(line.analysis.tokens, b.lemma, b.pos) ?? candidate;
        this.db
          .prepare("UPDATE words SET encounters = encounters + 1, last_seen_at = ? WHERE id = ?")
          .run(line.receivedAt, row.id);
        this.addContext(row.id, line, token, line.receivedAt);
      }
    }
    return seen.size > 0;
  }

  remove(id: number): void {
    const { changes } = this.db.prepare("DELETE FROM words WHERE id = ?").run(id);
    if (!changes) throw new WordBankError("No such word", 404);
  }

  get(id: number): SavedWord | undefined {
    return this.load("WHERE w.id = ?", [id])[0];
  }

  list(): SavedWord[] {
    return this.load("", []);
  }

  private load(where: string, params: (number | string)[]): SavedWord[] {
    const words = this.db
      .prepare(`SELECT w.* FROM words w ${where} ORDER BY w.created_at DESC, w.id DESC`)
      .all(...params) as unknown as WordRow[];
    if (words.length === 0) return [];
    const ids = words.map((w) => w.id);
    const marks = ids.map(() => "?").join(",");
    const contexts = this.db
      .prepare(
        `SELECT c.word_id, c.line_id, c.form, c.start, c.end, c.created_at, l.text, l.translation
         FROM word_contexts c JOIN lines l ON l.id = c.line_id
         WHERE c.word_id IN (${marks}) ORDER BY c.created_at DESC, c.id DESC`,
      )
      .all(...ids) as unknown as ContextRow[];
    const cards = this.db
      .prepare(`SELECT * FROM cards WHERE word_id IN (${marks}) ORDER BY id`)
      .all(...ids) as unknown as CardRow[];
    const kinds = new Set(this.enabledKinds());
    return words.map((w) => {
      const articles = articlesFor(w.gender);
      return {
        id: w.id,
        lemma: w.lemma,
        pos: w.pos,
        ...(w.gender ? { gender: w.gender } : {}),
        ...(articles ? { articles } : {}),
        ...(w.plural ? { plural: w.plural } : {}),
        glosses: JSON.parse(w.glosses) as string[],
        createdAt: w.created_at,
        encounters: w.encounters,
        lastSeenAt: w.last_seen_at,
        contexts: contexts
          .filter((c) => c.word_id === w.id)
          .map(
            (c): WordContext => ({
              lineId: c.line_id,
              text: c.text,
              translation: c.translation,
              form: c.form,
              start: c.start,
              end: c.end,
              seenAt: c.created_at,
            }),
          ),
        cards: cards.filter((c) => c.word_id === w.id && kinds.has(c.kind)).map(summary),
      };
    });
  }

  // Hidden words ------------------------------------------------------------

  hiddenWords(): HiddenWord[] {
    const rows = this.db.prepare("SELECT lemma, pos, gloss FROM hidden_words ORDER BY hidden_at DESC").all() as unknown as HiddenWord[];
    return rows.map(({ lemma, pos, gloss }) => ({ lemma, pos, gloss }));
  }

  hide(word: HiddenWord, now = Date.now()): void {
    if (!word.lemma || !word.pos) throw new WordBankError("lemma and pos are required");
    this.db
      .prepare("INSERT OR REPLACE INTO hidden_words (lemma, pos, gloss, hidden_at) VALUES (?, ?, ?, ?)")
      .run(word.lemma, word.pos, String(word.gloss ?? "").slice(0, 200), now);
  }

  unhide(lemma: string, pos: string): void {
    this.db.prepare("DELETE FROM hidden_words WHERE lemma = ? AND pos = ?").run(lemma, pos);
  }

  savedKeys(): string[] {
    return (this.db.prepare("SELECT lemma, pos FROM words").all() as { lemma: string; pos: string }[]).map((r) =>
      wordKey(r.lemma, r.pos),
    );
  }

  // Review -----------------------------------------------------------------

  private newIntroducedToday(now: number): number {
    return (
      this.db
        .prepare("SELECT count(DISTINCT card_id) AS n FROM review_log WHERE state = ? AND review >= ?")
        .get(STATE_NEW, dayStart(now)) as { n: number }
    ).n;
  }

  queue(now = Date.now()): ReviewQueue {
    const kinds = this.enabledKinds();
    const kindList = kinds.map(() => "?").join(",");
    const settings = this.settings();

    const dueCount = (
      this.db
        .prepare(`SELECT count(*) AS n FROM cards WHERE state != ? AND due <= ? AND kind IN (${kindList})`)
        .get(STATE_NEW, now, ...kinds) as { n: number }
    ).n;
    let due = this.db
      .prepare(
        `SELECT * FROM cards WHERE state != ? AND due <= ? AND kind IN (${kindList}) ORDER BY due LIMIT ${QUEUE_SIZE}`,
      )
      .all(STATE_NEW, now, ...kinds) as unknown as CardRow[];

    // New cards, at most newPerDay a day, one card per word a day ("article" waits until "meaning" was seen).
    const newAvailable = Math.max(0, settings.newPerDay - this.newIntroducedToday(now));
    const reviewedToday = new Set(
      (
        this.db
          .prepare("SELECT DISTINCT c.word_id FROM review_log r JOIN cards c ON c.id = r.card_id WHERE r.review >= ?")
          .all(dayStart(now)) as { word_id: number }[]
      ).map((r) => r.word_id),
    );
    const eligible: CardRow[] = [];
    const candidates = this.db
      .prepare(`SELECT * FROM cards WHERE state = ? AND kind IN (${kindList}) ORDER BY created_at, id`)
      .all(STATE_NEW, ...kinds) as unknown as CardRow[];
    for (const c of candidates) {
      if (eligible.length >= newAvailable) break;
      if (reviewedToday.has(c.word_id) || eligible.some((f) => f.word_id === c.word_id)) continue;
      eligible.push(c);
    }
    const fresh = eligible;

    if (due.length === 0 && fresh.length === 0) {
      due = this.db
        .prepare(
          `SELECT * FROM cards WHERE state IN (1, 3) AND due <= ? AND kind IN (${kindList}) ORDER BY due LIMIT ${QUEUE_SIZE}`,
        )
        .all(now + LEARN_AHEAD_MS, ...kinds) as unknown as CardRow[];
    }

    const items = [...due, ...fresh].slice(0, QUEUE_SIZE).map((c) => this.item(c, now));
    let nextDue: number | null = null;
    if (items.length === 0) {
      const next = this.db
        .prepare(`SELECT min(due) AS due FROM cards WHERE state != ? AND kind IN (${kindList})`)
        .get(STATE_NEW, ...kinds) as { due: number | null };
      nextDue = next.due;
      const waitingNew = this.db
        .prepare(`SELECT count(*) AS n FROM cards WHERE state = ? AND kind IN (${kindList})`)
        .get(STATE_NEW, ...kinds) as { n: number };
      if (waitingNew.n > 0) {
        const tomorrow = dayStart(now) + DAY_MS;
        nextDue = nextDue === null ? tomorrow : Math.min(nextDue, tomorrow);
      }
    }
    return { items, due: dueCount, newAvailable: eligible.length, nextDue, canUndo: this.canUndo() };
  }

  private item(c: CardRow, now: number): ReviewItem {
    return { card: summary(c), word: this.get(c.word_id)!, intervals: this.scheduler.preview(c, now) };
  }

  answer(cardId: number, grade: Grade, durationMs: number | undefined, now = Date.now()): CardSummary {
    if (![1, 2, 3, 4].includes(grade)) throw new WordBankError("grade must be 1, 2, 3 or 4");
    const card = this.db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId) as unknown as CardRow | undefined;
    if (!card) throw new WordBankError("No such card", 404);
    const { next, log } = this.scheduler.answer(card, grade, now);
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `UPDATE cards SET due = ?, stability = ?, difficulty = ?, scheduled_days = ?, learning_steps = ?,
                            reps = ?, lapses = ?, state = ?, last_review = ? WHERE id = ?`,
        )
        .run(next.due, next.stability, next.difficulty, next.scheduled_days, next.learning_steps, next.reps,
          next.lapses, next.state, next.last_review, cardId);
      this.db
        .prepare(
          `INSERT INTO review_log (card_id, grade, state, due, stability, difficulty, scheduled_days, learning_steps,
                                   review, duration_ms, card_before)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(cardId, log.grade, log.state, log.due, log.stability, log.difficulty, log.scheduled_days,
          log.learning_steps, log.review, durationMs ?? null, JSON.stringify(schedulingFields(card)));
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return summary({ ...card, ...next });
  }

  /** Whether there is an answer to take back (answers from before undo existed can't be). */
  canUndo(): boolean {
    const last = this.db.prepare("SELECT card_before AS before FROM review_log ORDER BY id DESC LIMIT 1").get() as
      | { before: string | null }
      | undefined;
    return !!last?.before;
  }

  /** Take back the most recent answer: the card goes back as it was, and the answer leaves the log. */
  undo(): CardSummary {
    const last = this.db.prepare("SELECT id, card_id, card_before AS before FROM review_log ORDER BY id DESC LIMIT 1").get() as
      | { id: number; card_id: number; before: string | null }
      | undefined;
    if (!last?.before) throw new WordBankError("Nothing to undo", 409);
    const b = JSON.parse(last.before) as CardFields;
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `UPDATE cards SET due = ?, stability = ?, difficulty = ?, scheduled_days = ?, learning_steps = ?,
                            reps = ?, lapses = ?, state = ?, last_review = ? WHERE id = ?`,
        )
        .run(b.due, b.stability, b.difficulty, b.scheduled_days, b.learning_steps, b.reps, b.lapses, b.state,
          b.last_review, last.card_id);
      this.db.prepare("DELETE FROM review_log WHERE id = ?").run(last.id);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return summary(this.db.prepare("SELECT * FROM cards WHERE id = ?").get(last.card_id) as unknown as CardRow);
  }

  stats(now = Date.now()): WordBankStats {
    const q = this.queue(now);
    const words = (this.db.prepare("SELECT count(*) AS n FROM words").get() as { n: number }).n;
    const reviewedToday = (
      this.db.prepare("SELECT count(*) AS n FROM review_log WHERE review >= ?").get(dayStart(now)) as { n: number }
    ).n;
    const r = this.db
      .prepare(
        `SELECT count(*) AS total, coalesce(sum(grade > 1), 0) AS kept FROM review_log WHERE state = ? AND review >= ?`,
      )
      .get(STATE_REVIEW, now - 30 * DAY_MS) as { total: number; kept: number };
    return {
      words,
      dueNow: q.due + q.newAvailable,
      reviewedToday,
      retention30d: r.total > 0 ? r.kept / r.total : null,
      reviews30d: r.total,
    };
  }
}

function summary(c: CardRow): CardSummary {
  return { id: c.id, kind: c.kind, state: STATE_NAMES[c.state] ?? "new", due: c.due, reps: c.reps, lapses: c.lapses };
}
