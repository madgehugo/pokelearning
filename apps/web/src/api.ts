/** Calls to the server's JSON API (same origin; Vite proxies it in development). */
import type {
  AnswerRequest,
  GameAvailability,
  GameKind,
  GameMaterial,
  GameRecord,
  GameResultRequest,
  GameResultResponse,
  Language,
  ReviewQueue,
  SavedWord,
  HiddenWord,
  SaveWordRequest,
  Settings,
} from "@pokelearning/shared";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error;
    throw new Error(msg ?? `${method} ${path} failed (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  saveWord: (req: SaveWordRequest) => call<SavedWord>("POST", "/api/words", req),
  hideWord: (word: HiddenWord) => call<void>("POST", "/api/hidden", word),
  showWord: (word: Pick<HiddenWord, "lemma" | "pos" | "lang">) => call<void>("POST", "/api/hidden/remove", word),
  removeWord: (id: number) => call<void>("DELETE", `/api/words/${id}`),
  words: (lang: Language) => call<SavedWord[]>("GET", `/api/words?lang=${lang}`),
  queue: (lang: Language) => call<ReviewQueue>("GET", `/api/review?lang=${lang}`),
  undo: (lang: Language) => call<ReviewQueue>("POST", `/api/review/undo?lang=${lang}`, {}),
  answer: (cardId: number, req: AnswerRequest, lang: Language) => call<ReviewQueue>("POST", `/api/review/${cardId}?lang=${lang}`, req),
  settings: () => call<Settings>("GET", "/api/settings"),
  updateSettings: (patch: Partial<Settings>) => call<Settings>("PUT", "/api/settings", patch),
  games: (lang: Language) => call<{ availability: GameAvailability[]; records: GameRecord[] }>("GET", `/api/games?lang=${lang}`),
  gameMaterial: <K extends GameKind>(kind: K, lang: Language) => call<Extract<GameMaterial, { kind: K }>>("GET", `/api/games/${kind}?lang=${lang}`),
  saveGameResult: (result: GameResultRequest) => call<GameResultResponse>("POST", "/api/games/results", result),
};
