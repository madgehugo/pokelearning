/**
 * Local, free machine translation with Helsinki-NLP Opus-MT models (ONNX
 * versions from Xenova) via transformers.js. The model (~110 MB) is downloaded
 * on first use into data/models; afterwards it works offline.
 */
import { env, pipeline, type TranslationPipeline } from "@huggingface/transformers";
import type { ProviderStatus, TranslationProvider } from "./provider.ts";

/** What transformers.js reports while it fetches model files. */
interface LoadProgress {
  status: string;
  file?: string;
  loaded?: number;
  total?: number;
}

export class OpusMtProvider implements TranslationProvider {
  readonly id: string;
  private model: Promise<TranslationPipeline> | null = null;
  /** One translation at a time; the model isn't re-entrant. */
  private queue: Promise<unknown> = Promise.resolve();
  private loadState: ProviderStatus = { state: "idle", progress: null, detail: "" };
  private files = new Map<string, { loaded: number; total: number }>();

  constructor(
    private readonly modelsDir: string,
    private readonly from = "de",
    private readonly to = "en",
  ) {
    this.id = `opus-mt-${from}-${to}-q8`;
  }

  private load(): Promise<TranslationPipeline> {
    if (!this.model) {
      env.cacheDir = this.modelsDir;
      this.files.clear();
      this.loadState = { state: "loading", progress: null, detail: "Loading the translation model" };
      this.model = pipeline("translation", `Xenova/opus-mt-${this.from}-${this.to}`, {
        dtype: "q8",
        progress_callback: (p: LoadProgress) => this.onLoadProgress(p),
      }) as Promise<TranslationPipeline>;
      this.model.then(
        () => (this.loadState = { state: "ready", progress: 1, detail: "Translation model ready" }),
        (err: Error) => {
          this.model = null; // allow a retry, e.g. after a network error
          this.loadState = { state: "failed", progress: null, detail: `Couldn't load the translation model: ${err.message}` };
        },
      );
    }
    return this.model;
  }

  private onLoadProgress(p: LoadProgress) {
    if (p.status !== "progress" || !p.file || !p.total) return;
    this.files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
    let loaded = 0;
    let total = 0;
    for (const f of this.files.values()) [loaded, total] = [loaded + f.loaded, total + f.total];
    this.loadState = {
      state: "loading",
      progress: total ? loaded / total : null,
      detail: `Downloading the translation model: ${(loaded / 1e6).toFixed(0)} of ${(total / 1e6).toFixed(0)} MB`,
    };
  }

  status(): ProviderStatus {
    return this.loadState;
  }

  supports(from: string, to: string): boolean {
    return from === this.from && to === this.to;
  }

  async warmUp(): Promise<void> {
    await this.load();
  }

  translate(text: string, from: string, to: string): Promise<string> {
    if (from !== this.from || to !== this.to) {
      return Promise.reject(new Error(`${this.id} cannot translate ${from}→${to}`));
    }
    const run = this.queue.then(async () => {
      const model = await this.load();
      const out = (await model(text)) as { translation_text: string }[];
      return out[0]?.translation_text ?? "";
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
