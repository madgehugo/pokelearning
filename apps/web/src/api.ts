/** Calls to the server's JSON API (same origin; Vite proxies it in development). */
import type { AnswerRequest, ReviewQueue, SavedWord, SaveWordRequest, Settings } from "@pokelearning/shared";

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
  removeWord: (id: number) => call<void>("DELETE", `/api/words/${id}`),
  words: () => call<SavedWord[]>("GET", "/api/words"),
  queue: () => call<ReviewQueue>("GET", "/api/review"),
  answer: (cardId: number, req: AnswerRequest) => call<ReviewQueue>("POST", `/api/review/${cardId}`, req),
  settings: () => call<Settings>("GET", "/api/settings"),
  updateSettings: (patch: Partial<Settings>) => call<Settings>("PUT", "/api/settings", patch),
};
