/**
 * First-launch setup: game names, then the dictionary, then the translation
 * model, each downloaded only if missing. The server runs without them
 * (lines arrive untranslated, without a breakdown) and picks them up as soon
 * as each one is ready.
 */
import type { SetupState, SetupStatus, SetupStep, SetupStepId } from "@pokelearning/shared";
import type { ProviderStatus } from "../translate/provider.ts";
import type { Progress } from "./download.ts";

export interface SetupDeps {
  namesReady(): boolean;
  dictionaryReady(): boolean;
  importNames(onProgress: Progress): Promise<unknown>;
  importDictionary(onProgress: Progress): Promise<unknown>;
  /** The translation model, or null if translation is off. */
  model: { status(): ProviderStatus; warmUp(): Promise<void> } | null;
  /** Called after names or the dictionary were imported, to load them. */
  onImported(step: "names" | "dictionary"): void;
  /** Called whenever the status changes. */
  onChange?(): void;
}

interface ImportStep {
  state: SetupState;
  progress: number | null;
  detail: string;
}

const MODEL_STATE: Record<ProviderStatus["state"], SetupState> = {
  idle: "waiting",
  loading: "running",
  ready: "ready",
  failed: "failed",
};

export class Setup {
  private steps: Record<"names" | "dictionary", ImportStep>;
  private running: Promise<void> | null = null;

  constructor(private readonly deps: SetupDeps) {
    this.steps = {
      names: deps.namesReady() ? done("Game names ready") : missing(),
      dictionary: deps.dictionaryReady() ? done("Dictionary ready") : missing(),
    };
  }

  status(): SetupStatus {
    const model = this.modelStep();
    const steps: SetupStep[] = [
      { id: "names", ...this.steps.names },
      { id: "dictionary", ...this.steps.dictionary },
      model,
    ];
    return { steps, ready: steps.every((s) => s.state === "ready") };
  }

  private modelStep(): SetupStep {
    if (!this.deps.model) return { id: "model", state: "ready", progress: 1, detail: "Translation is turned off" };
    const s = this.deps.model.status();
    return { id: "model", state: MODEL_STATE[s.state], progress: s.progress, detail: s.detail };
  }

  /** Start whatever is missing or failed. Safe to call again while it runs. */
  start(): Promise<void> {
    this.running ??= this.run().finally(() => (this.running = null));
    return this.running;
  }

  private async run(): Promise<void> {
    for (const id of ["names", "dictionary"] as const) {
      if (this.steps[id].state !== "ready") this.set(id, { state: "waiting", progress: null, detail: "Waiting" });
    }
    await this.runImport("names", (p) => this.deps.importNames(p), "Game names ready");
    await this.runImport("dictionary", (p) => this.deps.importDictionary(p), "Dictionary ready");
    const model = this.deps.model;
    if (model && model.status().state !== "ready") {
      this.deps.onChange?.();
      await model.warmUp().catch(() => {}); // its status says what went wrong
    }
    this.deps.onChange?.();
  }

  private async runImport(id: "names" | "dictionary", work: (p: Progress) => Promise<unknown>, doneText: string) {
    if (this.steps[id].state === "ready") return;
    this.set(id, { state: "running", progress: 0, detail: "Starting" });
    try {
      await work((progress, detail) => this.set(id, { state: "running", progress, detail }));
      this.set(id, done(doneText));
      this.deps.onImported(id);
    } catch (err) {
      this.set(id, { state: "failed", progress: null, detail: friendly(err as Error) });
    }
  }

  private lastNotified = 0;
  private set(id: SetupStepId & ("names" | "dictionary"), step: ImportStep) {
    const prev = this.steps[id];
    this.steps[id] = step;
    // progress updates many times a second: tell listeners at most every 250 ms
    const now = Date.now();
    if (step.state !== prev.state || now - this.lastNotified > 250) {
      this.lastNotified = now;
      this.deps.onChange?.();
    }
  }
}

const done = (detail: string): ImportStep => ({ state: "ready", progress: 1, detail });
const missing = (): ImportStep => ({ state: "missing", progress: null, detail: "Not downloaded yet" });

function friendly(err: Error): string {
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT/i.test(`${err.message} ${(err.cause as Error)?.message ?? ""}`)) {
    return "No internet connection. Connect and try again.";
  }
  return err.message;
}
