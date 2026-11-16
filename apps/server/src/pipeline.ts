/**
 * The language pipeline: store a received line, analyse it word by word,
 * translate it. Lines are processed one at a time in arrival order, and each
 * finished line is emitted as a "line" event (the phase 3 WebSocket listens here).
 */
import { EventEmitter } from "node:events";
import type { LineMessage, ProcessedLine, Translation } from "@pokelearning/shared";
import type { AppDb } from "./db/app-db.ts";
import { analyzeLine, type AnalyzerDeps } from "./language/analyze.ts";
import type { Translator } from "./translate/translator.ts";

export interface PipelineEvents {
  line: [ProcessedLine];
  error: [Error, LineMessage];
}

/** Languages the analyser and dictionary support. */
const ANALYSED_LANGS = new Set(["de"]);

export class LinePipeline extends EventEmitter<PipelineEvents> {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: AppDb,
    private readonly analyzer: AnalyzerDeps,
    private readonly translator: Translator | null,
    private readonly targetLang: string,
  ) {
    super();
  }

  /** Queue a line; resolves once it is processed (and emitted). */
  submit(msg: LineMessage): Promise<ProcessedLine | null> {
    const receivedAt = Date.now();
    const result = this.queue.then(() => this.process(msg, receivedAt));
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result.catch((err: Error) => {
      this.emit("error", err, msg);
      return null;
    });
  }

  private async process(msg: LineMessage, receivedAt: number): Promise<ProcessedLine> {
    const id = this.db.insertLine(msg, receivedAt);
    const lang = msg.lang ?? "de";

    const analysis = ANALYSED_LANGS.has(lang) ? analyzeLine(msg.line, this.analyzer) : null;
    if (analysis) this.db.saveAnalysis(id, analysis);

    let translation: Translation | null = null;
    if (this.translator && lang !== this.targetLang) {
      try {
        translation = await this.translator.translateLine(msg.line, lang, this.targetLang);
        this.db.saveLineTranslation(id, translation.provider, translation.text);
      } catch (err) {
        // A failed translation shouldn't lose the line or its analysis.
        this.emit("error", err as Error, msg);
      }
    }

    const processed: ProcessedLine = {
      id,
      game: msg.game,
      ...(msg.meta?.source ? { source: msg.meta.source } : {}),
      ...(msg.lang ? { lang: msg.lang } : {}),
      text: msg.line,
      receivedAt,
      analysis,
      translation,
    };
    this.emit("line", processed);
    return processed;
  }
}
