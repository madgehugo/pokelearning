/**
 * The glossaries the server uses: imported game names plus the hand-written
 * game terms. Each game gets the names of its own generation and regions
 * (FireRed: Kanto, Emerald: Hoenn); glossaries are built once per scope.
 */
import type { Language } from "@pokelearning/shared";
import { config } from "../config.ts";
import { loadGlossary, type Glossary } from "./glossary.ts";
import { loadNames, nameEntries, type GameScope, type NamesFile } from "./names.ts";

/** "pokemon-emerald-es" → "es". Anything unrecognised is German, the original language. */
export function languageOf(game: string): Language {
  return game.endsWith("-es") ? "es" : "de";
}

/** "pokemon-firered-de" → FireRed's scope; anything else → the default scope. */
export function scopeFor(game: string): GameScope {
  const title = game.match(/^pokemon-([a-z]+)-/)?.[1];
  return (title && config.gameScopes[title]) || config.namesScope;
}

export interface GameGlossaries {
  /** The glossary for a game id. */
  forGame(game: string): Glossary;
  /** Number of name entries for a game id, or null if no names were imported. */
  nameCount(game: string): number | null;
}

export function loadGameGlossaries(names: NamesFile | null = loadNames(config.namesPath)): GameGlossaries {
  const cache = new Map<string, { glossary: Glossary; count: number }>();
  const build = (game: string) => {
    const scope = scopeFor(game);
    const lang = languageOf(game);
    const key = `${lang}:${scope.generation}:${scope.regions.join(",")}`;
    let hit = cache.get(key);
    if (!hit) {
      const entries = names ? nameEntries(names, scope, lang) : [];
      hit = { glossary: loadGlossary(entries, lang), count: entries.length };
      cache.set(key, hit);
    }
    return hit;
  };
  return {
    forGame: (game) => build(game).glossary,
    nameCount: (game) => (names ? build(game).count : null),
  };
}

/** The default game's glossary (Emerald), for scripts and tools. */
export function loadGameGlossary(): { glossary: Glossary; names: number | null } {
  const g = loadGameGlossaries();
  return { glossary: g.forGame("pokemon-emerald-de"), names: g.nameCount("pokemon-emerald-de") };
}
