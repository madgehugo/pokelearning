/** Translate whole game lines: prepare, split into sentences, cache each sentence. */
import type { Translation } from "@pokelearning/shared";
import type { AppDb } from "../db/app-db.ts";
import type { Glossary } from "../language/glossary.ts";
import { prepareForTranslation, splitSentences } from "./prepare.ts";
import type { TranslationProvider } from "./provider.ts";

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

  async translateLine(text: string, from: string, to: string): Promise<Translation> {
    const sentences = splitSentences(prepareForTranslation(text, this.glossary));
    let allCached = true;
    const out: string[] = [];
    for (const sentence of sentences) {
      let translated = this.db.getCachedTranslation(this.provider.id, from, to, sentence);
      if (translated === undefined) {
        allCached = false;
        translated = await this.provider.translate(sentence, from, to);
        this.db.cacheTranslation(this.provider.id, from, to, sentence, translated);
      }
      out.push(translated);
    }
    return { provider: this.provider.id, from, to, text: out.join(" "), cached: allCached };
  }
}
