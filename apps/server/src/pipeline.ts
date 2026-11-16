/**
 * The language pipeline: store a received line, analyse it word by word,
 * translate it. Lines are processed one at a time in arrival order, and each
 * finished line is emitted as a "line" event (the phase 3 WebSocket listens here).
 */
import { EventEmitter } from "node:events";
import type { LineMessage, ProcessedLine, Translation } from "@pokelearning/shared";
import type { AppDb } from "./db/app-db.ts";
import { analyzeLine, type AnalyzerDeps } from "./language/analyze.ts";

/** Analyzer dependencies, or a function that picks them by game id (names differ per game). */
export type AnalyzerFor = AnalyzerDeps | ((game: string) => AnalyzerDeps);
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
    private readonly analyzer: AnalyzerFor,
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

  /** A menu screen is a list of separate labels, one per line: translate each on its own. */
  private async translateMenu(text: string, lang: string, glossary: AnalyzerDeps["glossary"]): Promise<Translation> {
    const parts: Translation[] = [];
    for (const item of text.split("\n").filter((l) => l.trim())) {
      parts.push(await this.translator!.translateLine(item, lang, this.targetLang, glossary));
    }
    return { ...parts[0]!, text: parts.map((p) => p.text).join("\n"), cached: parts.every((p) => p.cached) };
  }

  private async process(msg: LineMessage, receivedAt: number): Promise<ProcessedLine> {
    const id = this.db.insertLine(msg, receivedAt);
    const seenBefore = this.db.countEarlier(msg.game, msg.line, id);
    const lang = msg.lang ?? "de";

    const deps = typeof this.analyzer === "function" ? this.analyzer(msg.game) : this.analyzer;
    const analysis = ANALYSED_LANGS.has(lang) ? analyzeLine(msg.line, deps) : null;
    if (analysis) this.db.saveAnalysis(id, analysis);

    let translation: Translation | null = null;
    if (this.translator?.supports(lang, this.targetLang)) {
      try {
        translation = msg.meta?.source === "menu"
          ? await this.translateMenu(msg.line, lang, deps.glossary)
          : await this.translator.translateLine(msg.line, lang, this.targetLang, deps.glossary);
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
      seenBefore,
    };
    this.emit("line", processed);
    return processed;
  }
}
