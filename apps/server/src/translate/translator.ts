/** Translate whole game lines: prepare, split into sentences, cache each sentence. */
import type { Translation } from "@pokelearning/shared";
import type { AppDb } from "../db/app-db.ts";
import type { Glossary } from "../language/glossary.ts";
import { titleCase } from "../language/tokenize.ts";
import { fillSlots, prepareSentences, restoreSlots } from "./prepare.ts";
import type { ProviderStatus, TranslationProvider } from "./provider.ts";

/** A speaker label at the start of a text: capitals (names, titles) and a colon, then a sentence. */
const SPEAKER = /^(\p{Lu}[\p{Lu}\p{M}.'’ -]{1,24}?):\s+(?=\S.{6,})/u;

const TITLE = /^(?:MR|MRS|SR|SRA|SRTA|DR|DRA|PROF|CAP|KAPT|HERR|FRAU)\.?$/;

export class Translator {
  constructor(
    private readonly provider: TranslationProvider,
    private readonly db: AppDb,
    private readonly glossary: Glossary,
  ) {}

  get providerId(): string {
    return this.provider.id;
  }

  warmUp(): Promise<void> {
    return this.provider.warmUp();
  }

  supports(from: string, to: string): boolean {
    return this.provider.supports(from, to);
  }

  status(): ProviderStatus {
    return this.provider.status?.() ?? { state: "ready", progress: 1, detail: "" };
  }

  /**
   * Opus-MT sometimes falls into a loop on a very short text ("Items" → "♪ ♪ ♪ …"). Try the text as a
   * sentence; if that loops too, show the original rather than rubbish.
   */
  private async translateSentence(sentence: string, from: string, to: string): Promise<string> {
    const text = await this.provider.translate(sentence, from, to);
    if (!isDegenerate(sentence, text)) return text;
    const retry = await this.provider.translate(`${sentence}.`, from, to);
    return isDegenerate(sentence, retry) ? sentence : retry.replace(/\.$/, "");
  }

  /** Cached translation of one sentence. */
  private async cached(sentence: string, from: string, to: string): Promise<{ text: string; cached: boolean }> {
    const hit = this.db.getCachedTranslation(this.provider.id, from, to, sentence);
    if (hit !== undefined) return { text: hit, cached: true };
    const text = await this.translateSentence(sentence, from, to);
    this.db.cacheTranslation(this.provider.id, from, to, sentence, text);
    return { text, cached: false };
  }

  /** `glossary` is the line's game's glossary (defaults to the one given at construction). */
  async translateLine(
    text: string,
    from: string,
    to: string,
    glossary: Glossary = this.glossary,
    isWord?: (word: string) => boolean,
  ): Promise<Translation> {
    // "MELI: Estamos…": the model drops a speaker's name, so the name is handled on its own
    const speaker = text.match(SPEAKER);
    if (speaker) {
      const label = speaker[1]!;
      const words = label.split(/\s+/);
      // Titles don't decide: "PROF. ABEDUL" is a title and a plain word (abedul = birch, "Prof. Birch").
      // A name nobody lists ("MELI", "MC") stays as written, because the model mangles it.
      const bare = words.filter((w) => !TITLE.test(w));
      let name: { text: string; cached: boolean } | null = null;
      if (bare.length > 0 && bare.every((w) => glossary.get(w) || isWord?.(w))) {
        const spelled = words.map((w) => (TITLE.test(w) ? titleCase(w) : w)).join(" ");
        const translated = await this.translateLine(spelled, from, to, glossary);
        if (translated.text.replace(/[^\p{L}]/gu, "").length >= 3) name = translated; // "MAMÁ" → "Mom", not "M"
      }
      const rest = await this.translateLine(text.slice(speaker[0].length), from, to, glossary, isWord);
      const shown = name?.text ?? words.map((w) => titleCase(w)).join(" "); // a name stays as written
      return { ...rest, text: `${shown}: ${rest.text}`, cached: (name?.cached ?? true) && rest.cached };
    }
    let allCached = true;
    const out: string[] = [];
    for (const sentence of prepareSentences(text, glossary, from)) {
      const first = await this.cached(sentence.text, from, to);
      allCached &&= first.cached;
      let translated = restoreSlots(first.text, sentence.slots);
      if (translated === null) {
        // The translator dropped a placeholder: translate with the English names written in.
        const fallback = await this.cached(fillSlots(sentence), from, to);
        allCached &&= fallback.cached;
        translated = fallback.text;
      }
      out.push(translated);
    }
    return { provider: this.provider.id, from, to, text: out.join(" "), cached: allCached };
  }
}

/** How often the most repeated run of three words occurs in a text. */
function mostRepeatedPhrase(text: string): number {
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  const counts = new Map<string, number>();
  let most = 0;
  for (let i = 0; i + 3 <= tokens.length; i++) {
    const g = tokens.slice(i, i + 3).join(" ");
    const n = (counts.get(g) ?? 0) + 1;
    counts.set(g, n);
    most = Math.max(most, n);
  }
  return most;
}

/** A translation that repeats one token over and over, or is far longer than its source. */
export function isDegenerate(source: string, translation: string): boolean {
  // Opus-MT, trained on EU texts, sometimes invents a sentence about "the Commission" for a fragment
  if (/\b(?:Commission|Member States|Parliament|Directive)\b/.test(translation) && !/Kommission|Mitglied|Parlament|Richtlinie|Comisión|Estados miembros|Directiva/i.test(source)) return true;
  // a phrase repeated over and over ("I'm a little old, I'm a little old, …"), more than the source does
  if (mostRepeatedPhrase(translation) >= 4 && mostRepeatedPhrase(translation) > mostRepeatedPhrase(source)) return true;
  const words = translation.split(/\s+/).filter(Boolean);
  if (words.length >= 8 && new Set(words).size <= 2 && source.split(/\s+/).length < words.length / 2) return true;
  return translation.length > source.length * 6 + 40;
}

/** What the pipeline needs from a translator: Translator, or a TranslatorSet that picks one by language. */
export interface LineTranslator {
  supports(from: string, to: string): boolean;
  translateLine(text: string, from: string, to: string, glossary?: Glossary, isWord?: (word: string) => boolean): Promise<Translation>;
}

/** One translator per source language ("de", "es"). */
export class TranslatorSet implements LineTranslator {
  constructor(private readonly byLanguage: Map<string, Translator>) {}

  supports(from: string, to: string): boolean {
    return this.byLanguage.get(from)?.supports(from, to) ?? false;
  }

  translateLine(text: string, from: string, to: string, glossary?: Glossary, isWord?: (word: string) => boolean): Promise<Translation> {
    const translator = this.byLanguage.get(from);
    if (!translator) return Promise.reject(new Error(`no translator for ${from}`));
    return translator.translateLine(text, from, to, glossary, isWord);
  }
}
