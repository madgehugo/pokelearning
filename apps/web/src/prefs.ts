/** Display preferences, kept per browser (the panel and the website each have their own). */
import { useSyncExternalStore } from "react";
import type { Language } from "@pokelearning/shared";

export interface Prefs {
  /** Multiplies every size on the page. */
  textScale: number;
  /** Lines print in piece by piece, like the game's text. */
  printIn: boolean;
  /** Which language you study: its saved words, review cards, hidden words and games. */
  language: Language;
}

export const TEXT_SCALES = [0.85, 1, 1.15, 1.3, 1.5];
const KEY = "pokelearning-prefs";
const DEFAULTS: Prefs = { textScale: 1, printIn: true, language: "de" };

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs> & { gameLanguage?: Language };
    return {
      textScale: TEXT_SCALES.includes(raw.textScale as number) ? (raw.textScale as number) : DEFAULTS.textScale,
      printIn: typeof raw.printIn === "boolean" ? raw.printIn : DEFAULTS.printIn,
      language: (raw.language ?? raw.gameLanguage) === "es" ? "es" : "de", // gameLanguage: the name before 0.2
    };
  } catch {
    return DEFAULTS; // storage blocked or unreadable: the defaults still work
  }
}

let current = load();
const listeners = new Set<() => void>();

function apply(p: Prefs) {
  document.documentElement.style.setProperty("--text-scale", String(p.textScale));
}
apply(current);

export function setPrefs(patch: Partial<Prefs>) {
  current = { ...current, ...patch };
  apply(current);
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // not saved, but it still applies until the page is closed
  }
  for (const l of listeners) l();
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
