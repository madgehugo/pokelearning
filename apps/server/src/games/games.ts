/**
 * Mini-games built from your own material: the words you saved first, then
 * the words and lines from what you've played. Results are kept separately
 * from FSRS review, so games are practice without changing your intervals.
 */
import type { DatabaseSync } from "node:sqlite";
import {
  shortGloss,
  wordKey,
  type ArticleItem,
  type ClozeRound,
  type GameAvailability,
  type Language,
  type GameExample,
  type GameKind,
  type GameMaterial,
  type GameRecord,
  type GameResultRequest,
  type GameResultResponse,
  type ListeningRound,
  type MatchingPair,
  type ProcessedLine,
  type TokenAnalysis,
  type WordSense,
} from "@pokelearning/shared";
import type { AppDb } from "../db/app-db.ts";
import type { WordBank } from "../wordbank/wordbank.ts";

export const GAME_KINDS: GameKind[] = ["articles", "cloze", "listening", "matching"];

/** How much a full game uses, and the least it can be played with. */
const SIZES: Record<GameKind, { full: number; min: number }> = {
  articles: { full: 40, min: 10 },
  cloze: { full: 8, min: 4 },
  listening: { full: 6, min: 4 },
  matching: { full: 6, min: 4 },
};

/** Recent lines the games draw from. */
const CORPUS_LINES = 1500;
/** Parts of speech worth blanking out in a cloze. */
const CLOZE_POS = new Set(["noun", "verb", "adj", "adv"]);
/** Matching: a wrong tap costs this much time. */
export const MATCHING_PENALTY_MS = 3000;

export class GameError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

interface SeenWord {
  sense: WordSense;
  /** Lines it appeared in. */
  count: number;
  example: GameExample;
  saved: boolean;
  /**
   * Seen in normal spelling at least once. Words only ever seen in Gen 3
   * capitals are menu and battle words ("ZURÜCK", "NORMAL") that look like
   * nouns once capitalised, so the noun games skip them.
   */
  normalCase: boolean;
}

type Rng = () => number;

function shuffle<T>(list: T[], rng: Rng): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Saved words first, then the most frequent, with some shuffling inside each group. */
function prioritise(words: SeenWord[], rng: Rng): SeenWord[] {
  return shuffle(words, rng).sort((a, b) => Number(b.saved) - Number(a.saved) || b.count - a.count);
}

const singleArticle = (s: WordSense) => (s.articles?.length === 1 ? s.articles[0] : undefined);

function example(line: ProcessedLine, t: TokenAnalysis): GameExample {
  return { text: line.text, translation: line.translation?.text ?? null, start: t.start, end: t.phraseEnd ?? t.end };
}

export class Games {
  private readonly db: DatabaseSync;

  constructor(
    private readonly app: AppDb,
    private readonly wordbank: WordBank,
    private readonly rng: Rng = Math.random,
  ) {
    this.db = app.db;
  }

  private corpus(lang: Language): ProcessedLine[] {
    const seen = new Set<string>();
    return this.app.recentLines(CORPUS_LINES).filter((l) => {
      if (!l.analysis || (l.analysis.lang ?? "de") !== lang || seen.has(l.text)) return false;
      seen.add(l.text);
      return true;
    });
  }

  /** Every dictionary or game word seen, keyed by lemma + part of speech. */
  private seenWords(lines: ProcessedLine[], lang: Language): Map<string, SeenWord> {
    const saved = new Set(this.wordbank.savedKeys());
    const words = new Map<string, SeenWord>();
    for (const line of lines) {
      const inLine = new Set<string>();
      for (const t of line.analysis!.tokens) {
        const s = t.best;
        if (t.kind !== "word" || t.partOf !== undefined || !s || s.formTags === "separated prefix") continue;
        const key = wordKey(s.lemma, s.pos, s.lang);
        const normalCase = t.normalized === undefined;
        const w = words.get(key);
        if (!w) {
          words.set(key, { sense: s, count: 1, example: example(line, t), saved: saved.has(key), normalCase });
        } else {
          if (!inLine.has(key)) w.count++;
          if (normalCase && !w.normalCase) [w.normalCase, w.example] = [true, example(line, t)];
        }
        inLine.add(key);
      }
    }
    // saved words the recent lines don't contain still belong in the games
    for (const word of this.wordbank.list()) {
      if ((word.lang ?? "de") !== lang) continue;
      const key = wordKey(word.lemma, word.pos, word.lang);
      if (words.has(key)) continue;
      const c = word.contexts[0];
      words.set(key, {
        sense: { lemma: word.lemma, pos: word.pos, glosses: word.glosses, source: "dictionary", ...(word.lang ? { lang: word.lang } : {}), ...(word.articles ? { articles: word.articles } : {}), ...(word.plural ? { plural: word.plural } : {}) },
        count: word.encounters,
        example: c ? { text: c.text, translation: c.translation, start: c.start, end: c.end } : { text: "", translation: null, start: 0, end: 0 },
        saved: true,
        normalCase: true,
      });
    }
    return words;
  }

  // Material -----------------------------------------------------------------

  private articles(words: Map<string, SeenWord>): ArticleItem[] {
    const nouns = [...words.values()].filter(
      (w) =>
        (w.sense.pos === "noun" || w.sense.pos === "item") &&
        singleArticle(w.sense) &&
        w.sense.glosses.length &&
        w.sense.lemma.length >= 3 &&
        (w.saved || w.normalCase || w.sense.pos === "item"),
    );
    return prioritise(nouns, this.rng)
      .slice(0, SIZES.articles.full)
      .map((w) => ({
        lemma: w.sense.lemma,
        article: singleArticle(w.sense)!,
        ...(w.sense.plural ? { plural: w.sense.plural } : {}),
        gloss: shortGloss(w.sense.glosses[0]),
        saved: w.saved,
        ...(w.example.text ? { example: w.example } : {}),
      }));
  }

  private cloze(lines: ProcessedLine[], words: Map<string, SeenWord>): ClozeRound[] {
    // every content word form seen, by part of speech, as distractors
    const forms = new Map<string, Set<string>>();
    for (const line of lines) {
      for (const t of line.analysis!.tokens) {
        if (t.kind === "word" && t.best && CLOZE_POS.has(t.best.pos) && t.linkedTo === undefined && t.text.length >= 3) {
          const set = forms.get(t.best.pos) ?? new Set<string>();
          set.add(t.text);
          forms.set(t.best.pos, set);
        }
      }
    }
    const rounds: ClozeRound[] = [];
    for (const line of shuffle(lines, this.rng)) {
      const tokens = line.analysis!.tokens;
      const wordCount = tokens.filter((t) => t.kind === "word").length;
      if (wordCount < 4 || wordCount > 25) continue;
      const targets = tokens.filter(
        (t) => t.kind === "word" && t.best && CLOZE_POS.has(t.best.pos) && t.linkedTo === undefined && t.text.length >= 3,
      );
      if (targets.length === 0) continue;
      // blank a saved word if the line has one, else the most frequent content word
      const target = targets.sort((a, b) => {
        const wa = words.get(wordKey(a.best!.lemma, a.best!.pos, a.best!.lang));
        const wb = words.get(wordKey(b.best!.lemma, b.best!.pos, b.best!.lang));
        return Number(wb?.saved) - Number(wa?.saved) || (wb?.count ?? 0) - (wa?.count ?? 0);
      })[0]!;
      const pool = [...(forms.get(target.best!.pos) ?? [])].filter((f) => f.toLowerCase() !== target.text.toLowerCase());
      if (pool.length < 3) continue;
      const distractors = shuffle(pool, this.rng).slice(0, 3);
      rounds.push({
        lineId: line.id,
        text: line.text,
        translation: line.translation?.text ?? null,
        start: target.start,
        end: target.end,
        answer: target.text,
        options: shuffle([target.text, ...distractors], this.rng),
        lemma: target.best!.lemma,
        gloss: shortGloss(target.best!.glosses[0]),
      });
      if (rounds.length >= SIZES.cloze.full) break;
    }
    return rounds;
  }

  private listening(lines: ProcessedLine[]): ListeningRound[] {
    const usable = lines.filter((l) => {
      const n = l.text.split(/\s+/).length;
      return l.translation?.text && n >= 3 && n <= 20;
    });
    const byTranslation = new Map(usable.map((l) => [l.translation!.text, l]));
    const distinct = [...byTranslation.values()];
    if (distinct.length < 4) return [];
    return shuffle(distinct, this.rng)
      .slice(0, SIZES.listening.full)
      .map((l) => {
        const others = shuffle(distinct.filter((o) => o !== l), this.rng)
          .slice(0, 3)
          .map((o) => o.translation!.text);
        return { lineId: l.id, text: l.text, answer: l.translation!.text, options: shuffle([l.translation!.text, ...others], this.rng) };
      });
  }

  private matching(words: Map<string, SeenWord>): MatchingPair[] {
    const pairs: MatchingPair[] = [];
    const usedGloss = new Set<string>();
    for (const w of prioritise([...words.values()], this.rng)) {
      if (!CLOZE_POS.has(w.sense.pos) && w.sense.pos !== "item") continue;
      if (!w.saved && !w.normalCase && w.sense.pos !== "item") continue;
      // first meaning only, without explanations: "wild (of animals, etc.)" → "wild"
      const english = (w.sense.glosses[0] ?? "").replace(/\s*\([^()]*\)/g, "").split(/[;,]/)[0]!.trim();
      if (!english || usedGloss.has(english.toLowerCase())) continue;
      if (english.toLowerCase() === w.sense.lemma.toLowerCase()) continue; // "wild = wild" asks nothing
      usedGloss.add(english.toLowerCase());
      const gender = singleArticle(w.sense);
      pairs.push({
        id: pairs.length + 1,
        word: gender && w.sense.pos === "noun" ? `${gender} ${w.sense.lemma}` : w.sense.lemma,
        english,
        ...(gender ? { gender } : {}),
      });
      if (pairs.length >= SIZES.matching.full) break;
    }
    return pairs;
  }

  material(kind: GameKind, lang: Language = "de"): GameMaterial {
    const lines = this.corpus(lang);
    const words = this.seenWords(lines, lang);
    switch (kind) {
      case "articles":
        return { lang, kind, items: this.articles(words) };
      case "cloze":
        return { lang, kind, rounds: this.cloze(lines, words) };
      case "listening":
        return { lang, kind, rounds: this.listening(lines) };
      case "matching":
        return { lang, kind, pairs: this.matching(words) };
      default:
        throw new GameError(`unknown game ${JSON.stringify(kind)}`, 404);
    }
  }

  availability(lang: Language = "de"): GameAvailability[] {
    return GAME_KINDS.map((kind) => {
      const m = this.material(kind, lang);
      const available = m.kind === "articles" ? m.items.length : m.kind === "matching" ? m.pairs.length : m.rounds.length;
      return { kind, available, needed: SIZES[kind].min };
    });
  }

  // Results ------------------------------------------------------------------

  records(): GameRecord[] {
    return GAME_KINDS.map((kind) => this.record(kind));
  }

  private record(kind: GameKind): GameRecord {
    // matching: fastest time, each wrong tap adding a penalty; the others: most correct
    const stats = (
      kind === "matching"
        ? this.db
            .prepare("SELECT count(*) AS plays, min(duration_ms + ? * mistakes) AS best FROM game_results WHERE kind = ?")
            .get(MATCHING_PENALTY_MS, kind)
        : this.db.prepare("SELECT count(*) AS plays, max(score) AS best FROM game_results WHERE kind = ?").get(kind)
    ) as { plays: number; best: number | null };
    const last = this.db
      .prepare(
        `SELECT score, total, duration_ms AS durationMs, mistakes, played_at AS playedAt
         FROM game_results WHERE kind = ? ORDER BY played_at DESC, id DESC LIMIT 1`,
      )
      .get(kind) as GameRecord["last"] | undefined;
    return { kind, plays: stats.plays, best: stats.best, last: last ? { ...last } : null };
  }

  saveResult(r: GameResultRequest, now = Date.now()): GameResultResponse {
    if (!GAME_KINDS.includes(r.kind)) throw new GameError(`unknown game ${JSON.stringify(r.kind)}`);
    for (const k of ["score", "total", "durationMs", "mistakes"] as const) {
      if (!Number.isInteger(r[k]) || r[k] < 0) throw new GameError(`${k} must be a whole number ≥ 0`);
    }
    if (r.score > r.total) throw new GameError("score can't be higher than total");
    const before = this.record(r.kind).best;
    this.db
      .prepare("INSERT INTO game_results (kind, score, total, duration_ms, mistakes, played_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(r.kind, r.score, r.total, r.durationMs, r.mistakes, now);
    const value = r.kind === "matching" ? r.durationMs + MATCHING_PENALTY_MS * r.mistakes : r.score;
    const newBest = before === null ? r.score > 0 : r.kind === "matching" ? value < before : value > before;
    return { record: this.record(r.kind), newBest };
  }
}
