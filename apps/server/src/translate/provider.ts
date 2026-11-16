/** A machine translation backend. Implementations: opus-mt (local), later DeepL/LLM. */
export interface TranslationProvider {
  /** Stable id, part of the cache key: changing the model must change the id. */
  readonly id: string;
  /** Start loading (e.g. download the model) so the first line isn't slow. */
  warmUp(): Promise<void>;
  /** Translate one sentence. */
  translate(text: string, from: string, to: string): Promise<string>;
}
