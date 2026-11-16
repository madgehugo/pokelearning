/**
 * Turns a stream of OCR readings into finished messages. Game text types out
 * letter by letter, and OCR wobbles a little between captures, so a reading is
 * sent once it has stayed the same (ignoring spaces and case) for a few
 * captures. An empty text box resets it, so a message shown again is sent again.
 */

export interface StabilizerOptions {
  /** Captures in a row that must agree before a message is sent. */
  stableReadings?: number;
  /** Fewer letters than this is noise (or an empty box). */
  minLetters?: number;
}

/** "GrüBe" → "Grüße": pixel fonts make OCR read ß as B, which never stands between lowercase letters. */
export function fixEszett(text: string): string {
  return text.replace(/(?<=\p{Ll})B(?=\p{Ll}|[^\p{L}]|$)/gu, "ß");
}

/** One line of text, as the mGBA adapter sends it: line breaks become spaces, a hyphen at a break stays. */
export function cleanText(raw: string): string {
  return fixEszett(raw)
    .replace(/-\s*\n\s*/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?…:;])/g, "$1") // OCR often reads a gap before punctuation
    .trim();
}

/** What has to match for two readings to count as the same text. */
const key = (text: string) => text.toLowerCase().replace(/[\s.,!?…'’"„“”-]/g, "");

const letters = (text: string) => text.match(/\p{L}/gu)?.length ?? 0;

export class Stabilizer {
  private readonly stableReadings: number;
  private readonly minLetters: number;
  private candidate: string | null = null;
  private count = 0;
  private lastSent: string | null = null;

  constructor(options: StabilizerOptions = {}) {
    this.stableReadings = options.stableReadings ?? 2;
    this.minLetters = options.minLetters ?? 3;
  }

  /** Feed one OCR reading; returns the text to send, if a message just settled. */
  push(raw: string): string | null {
    const text = cleanText(raw);
    if (letters(text) < this.minLetters) {
      // empty or closed box: the next message counts as new, even if it's the same
      this.candidate = null;
      this.count = 0;
      this.lastSent = null;
      return null;
    }
    if (this.candidate !== null && key(text) === key(this.candidate)) {
      this.count++;
      this.candidate = text; // keep the latest spelling
    } else {
      this.candidate = text;
      this.count = 1;
    }
    if (this.count !== this.stableReadings) return null;
    const k = key(text);
    // already sent, or the box being redrawn with part of what was sent
    if (this.lastSent !== null && key(this.lastSent).startsWith(k)) return null;
    this.lastSent = text;
    return text;
  }
}
