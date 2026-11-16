/**
 * FSRS scheduling (ts-fsrs, FSRS-6 default parameters, 90% target retention).
 * Converts between database rows and ts-fsrs cards.
 */
import { createEmptyCard, fsrs, generatorParameters, type Card, type FSRS } from "ts-fsrs";
import type { CardState, Grade } from "@pokelearning/shared";

/** The scheduling columns of the `cards` table. */
export interface CardFields {
  due: number;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: number | null;
}

/** A `review_log` row, minus ids. */
export interface LogFields {
  grade: Grade;
  state: number;
  due: number;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  learning_steps: number;
  review: number;
}

export const STATE_NAMES: CardState[] = ["new", "learning", "review", "relearning"];
export const STATE_NEW = 0;
export const STATE_REVIEW = 2;

const GRADES: Grade[] = [1, 2, 3, 4];

function toCard(f: CardFields): Card {
  return {
    due: new Date(f.due),
    stability: f.stability,
    difficulty: f.difficulty,
    scheduled_days: f.scheduled_days,
    learning_steps: f.learning_steps,
    reps: f.reps,
    lapses: f.lapses,
    state: f.state,
    last_review: f.last_review === null ? undefined : new Date(f.last_review),
  } as Card;
}

function fromCard(c: Card): CardFields {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review ? c.last_review.getTime() : null,
  };
}

/** "1 min", "10 min", "3 h", "4 days", "2 mo", "1.5 yr". */
export function formatInterval(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)} h`;
  const days = h / 24;
  if (days < 30) return `${Math.round(days)} ${Math.round(days) === 1 ? "day" : "days"}`;
  if (days < 365) return `${Math.round(days / 30)} mo`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, "")} yr`;
}

export class Scheduler {
  private readonly f: FSRS;

  constructor(options: { fuzz?: boolean } = {}) {
    this.f = fsrs(generatorParameters({ enable_fuzz: options.fuzz ?? true, request_retention: 0.9 }));
  }

  newCard(now: number): CardFields {
    return fromCard(createEmptyCard(new Date(now)));
  }

  answer(card: CardFields, grade: Grade, now: number): { next: CardFields; log: LogFields } {
    const { card: next, log } = this.f.next(toCard(card), new Date(now), grade);
    return {
      next: fromCard(next),
      log: {
        grade,
        state: log.state,
        due: log.due.getTime(),
        stability: log.stability,
        difficulty: log.difficulty,
        scheduled_days: log.scheduled_days,
        learning_steps: log.learning_steps,
        review: now,
      },
    };
  }

  /** How long until the card comes back, for each grade. */
  preview(card: CardFields, now: number): Record<Grade, string> {
    const options = this.f.repeat(toCard(card), new Date(now));
    const out = {} as Record<Grade, string>;
    for (const g of GRADES) out[g] = formatInterval(options[g].card.due.getTime() - now);
    return out;
  }
}
