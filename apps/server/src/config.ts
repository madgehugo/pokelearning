import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROTOCOL_PORT, UI_PORT } from "@pokelearning/shared";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(repoRoot, "data"));

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  /** Adapter ingest. Always local: adapters run on this machine. */
  port: Number(process.env.PORT ?? PROTOCOL_PORT),
  /** Web UI. Set UI_HOST=0.0.0.0 to open it from your phone on the same Wi-Fi. */
  uiHost: process.env.UI_HOST ?? "127.0.0.1",
  uiPort: Number(process.env.UI_PORT ?? UI_PORT),
  webDistDir: path.join(repoRoot, "apps/web/dist"),
  dataDir,
  /** Your data: received lines, analyses, translation cache (later: word bank). */
  appDbPath: path.join(dataDir, "app.db"),
  /** Rebuildable: `npm run dict:import`. */
  dictionaryDbPath: path.join(dataDir, "dictionary.db"),
  kaikkiPath: path.join(dataDir, "kaikki-german.jsonl.gz"),
  kaikkiUrl: "https://kaikki.org/dictionary/German/kaikki.org-dictionary-German.jsonl.gz",
  modelsDir: path.join(dataDir, "models"),
  /** Game names (Pokémon, moves, abilities, items, places), from `npm run names:import`. */
  namesPath: path.join(dataDir, "pokemon-names.json"),
  /**
   * Which names a game uses, by its id ("pokemon-firered-de" → firered): its
   * generation and regions (1 Kanto, 3 Hoenn). Games not listed use the default,
   * which NAMES_GENERATION and NAMES_REGIONS can change.
   */
  gameScopes: {
    ruby: { generation: 3, regions: [3] },
    sapphire: { generation: 3, regions: [3] },
    emerald: { generation: 3, regions: [3] },
    firered: { generation: 3, regions: [1] },
    leafgreen: { generation: 3, regions: [1] },
  } as Record<string, { generation: number; regions: number[] }>,
  namesScope: {
    generation: Number(process.env.NAMES_GENERATION ?? 3),
    regions: (process.env.NAMES_REGIONS ?? "3").split(",").map(Number),
  },
  /** "opus-mt" (local, default) or "none". */
  translator: process.env.TRANSLATOR ?? "opus-mt",
  targetLang: "en",
};
