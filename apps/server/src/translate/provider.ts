/** Loading state of a provider that downloads a model first. */
export interface ProviderStatus {
  state: "idle" | "loading" | "ready" | "failed";
  /** 0–1 while downloading, if known. */
  progress: number | null;
  detail: string;
}

/** A machine translation backend. Implementations: opus-mt (local), later DeepL/LLM. */
export interface TranslationProvider {
  /** Loading state, for providers with something to download. */
  status?(): ProviderStatus;
  /** Stable id, part of the cache key: changing the model must change the id. */
  readonly id: string;
  /** Whether this provider can translate between these languages. */
  supports(from: string, to: string): boolean;
  /** Start loading (e.g. download the model) so the first line isn't slow. */
  warmUp(): Promise<void>;
  /** Translate one sentence. */
  translate(text: string, from: string, to: string): Promise<string>;
}
