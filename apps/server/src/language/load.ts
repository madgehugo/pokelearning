/** The glossary the server uses: imported Pokémon names plus the hand-written game terms. */
import { config } from "../config.ts";
import { defaultGlossaryFile, loadGlossary, type Glossary } from "./glossary.ts";
import { loadNames, nameEntries } from "./names.ts";

export function loadGameGlossary(): { glossary: Glossary; names: number | null } {
  const names = loadNames(config.namesPath);
  const entries = names ? nameEntries(names, config.namesMaxGeneration) : [];
  return { glossary: loadGlossary(defaultGlossaryFile, entries), names: names ? entries.length : null };
}
