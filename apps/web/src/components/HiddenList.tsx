import type { HiddenWord } from "@pokelearning/shared";
import { api } from "../api.ts";

/** Words hidden from the breakdown, each with a way to show it again. */
export function HiddenList({ words }: { words: HiddenWord[] }) {
  if (words.length === 0) return <p className="muted">No hidden words. Open a word and choose Hide this word.</p>;
  return (
    <ul className="hidden-list" aria-label="Hidden words">
      {words.map((w) => (
        <li key={`${w.lemma}|${w.pos}`}>
          <span className="hidden-list__word">
            <span lang="de">{w.lemma}</span> <span className="gloss">{w.gloss}</span>
          </span>
          <button type="button" className="link-button" onClick={() => void api.showWord(w).catch(() => undefined)}>
            Show again
          </button>
        </li>
      ))}
    </ul>
  );
}
