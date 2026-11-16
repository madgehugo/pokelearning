/**
 * Local, free machine translation with Helsinki-NLP Opus-MT models (ONNX
 * versions from Xenova) via transformers.js. The model (~110 MB) is downloaded
 * on first use into data/models; afterwards it works offline.
 */
import { env, pipeline, type TranslationPipeline } from "@huggingface/transformers";
import type { TranslationProvider } from "./provider.ts";

export class OpusMtProvider implements TranslationProvider {
  readonly id: string;
  private model: Promise<TranslationPipeline> | null = null;
  /** One translation at a time; the model isn't re-entrant. */
  private queue: Promise<unknown> = Promise.resolve();

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
      this.model = pipeline("translation", `Xenova/opus-mt-${this.from}-${this.to}`, { dtype: "q8" }) as Promise<TranslationPipeline>;
      this.model.catch(() => (this.model = null)); // allow a retry, e.g. after a network error
    }
    return this.model;
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
