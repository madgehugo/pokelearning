/** First-launch setup: downloading and preparing the data the server needs. */

/** "dictionary-es" and "model-es" exist once a Spanish game has been seen. */
export type SetupStepId = "names" | "dictionary" | "model" | "dictionary-es" | "model-es";

export type SetupState = "missing" | "waiting" | "running" | "ready" | "failed";

export interface SetupStep {
  id: SetupStepId;
  state: SetupState;
  /** 0–1 while running, if known. */
  progress: number | null;
  /** What's happening, or what went wrong, in plain words. */
  detail: string;
}

export interface SetupStatus {
  steps: SetupStep[];
  /** Everything is in place. */
  ready: boolean;
}
