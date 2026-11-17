/** Translate whole game lines: prepare, split into sentences, cache each sentence. */
import type { Translation } from "@pokelearning/shared";
import type { AppDb } from "../db/app-db.ts";
import type { Glossary } from "../language/glossary.ts";
import { fillSlots, prepareSentences, restoreSlots } from "./prepare.ts";
import type { ProviderStatus, TranslationProvider } from "./provider.ts";

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

  /** Cached translation of one sentence. */
  private async cached(sentence: string, from: string, to: string): Promise<{ text: string; cached: boolean }> {
    const hit = this.db.getCachedTranslation(this.provider.id, from, to, sentence);
    if (hit !== undefined) return { text: hit, cached: true };
    const text = await this.provider.translate(sentence, from, to);
    this.db.cacheTranslation(this.provider.id, from, to, sentence, text);
    return { text, cached: false };
  }

  /** `glossary` is the line's game's glossary (defaults to the one given at construction). */
  async translateLine(text: string, from: string, to: string, glossary: Glossary = this.glossary): Promise<Translation> {
    let allCached = true;
    const out: string[] = [];
    for (const sentence of prepareSentences(text, glossary)) {
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

/** What the pipeline needs from a translator: Translator, or a TranslatorSet that picks one by language. */
export interface LineTranslator {
  supports(from: string, to: string): boolean;
  translateLine(text: string, from: string, to: string, glossary?: Glossary): Promise<Translation>;
}

/** One translator per source language ("de", "es"). */
export class TranslatorSet implements LineTranslator {
  constructor(private readonly byLanguage: Map<string, Translator>) {}

  supports(from: string, to: string): boolean {
    return this.byLanguage.get(from)?.supports(from, to) ?? false;
  }

  translateLine(text: string, from: string, to: string, glossary?: Glossary): Promise<Translation> {
    const translator = this.byLanguage.get(from);
    if (!translator) return Promise.reject(new Error(`no translator for ${from}`));
    return translator.translateLine(text, from, to, glossary);
  }
}
