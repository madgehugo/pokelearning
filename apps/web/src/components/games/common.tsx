/** Pieces shared by the mini-games: loading material, the start screen, results. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GameExample, GameKind, GameMaterial, GameResultRequest, GameResultResponse } from "@pokelearning/shared";
import { api } from "../../api.ts";

export const GAME_INFO: Record<GameKind, { title: string; blurb: string; unit: string }> = {
  articles: { title: "Article sprint", blurb: "60 seconds. Pick der, die or das for as many nouns as you can.", unit: "nouns" },
  cloze: { title: "Fill the gap", blurb: "A line from your game with one word missing. Pick the word that fits.", unit: "lines" },
  listening: { title: "Listening", blurb: "Hear a line from your game, then pick what it means.", unit: "lines with translations" },
  matching: { title: "Matching", blurb: "Pair six German words with their meanings, as fast as you can.", unit: "words" },
};

export function useMaterial<K extends GameKind>(kind: K, round: number) {
  const [material, setMaterial] = useState<Extract<GameMaterial, { kind: K }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setMaterial(null);
    api.gameMaterial(kind).then(setMaterial, (err: Error) => setError(err.message));
  }, [kind, round]);
  return { material, error };
}

/** Milliseconds since `running` became true; frozen when it turns false. */
export function useStopwatch(running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const started = useRef<number | null>(null);
  useEffect(() => {
    if (!running) return;
    started.current = Date.now() - elapsed;
    const timer = setInterval(() => setElapsed(Date.now() - started.current!), 100);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  return elapsed;
}

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Space or Enter. */
export function useConfirmKey(enabled: boolean, onConfirm: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, onConfirm]);
}

/** Number keys 1…n pick option n. */
export function useNumberKeys(enabled: boolean, count: number, onPick: (index: number) => void) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= count) onPick(n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, count, onPick]);
}

export function StartScreen({ kind, onStart, extra }: { kind: GameKind; onStart(): void; extra?: ReactNode }) {
  useConfirmKey(true, onStart);
  return (
    <section className="box box--empty game-start">
      <p className="line">{GAME_INFO[kind].title}</p>
      <p className="box__hint">{GAME_INFO[kind].blurb}</p>
      {extra}
      <button type="button" className="primary-button" onClick={onStart}>
        Start <kbd>Space</kbd>
      </button>
    </section>
  );
}

/** Saves the result once and shows it. */
export function Results({
  result,
  summary,
  children,
  onAgain,
}: {
  result: GameResultRequest;
  summary: string;
  children?: ReactNode;
  onAgain(): void;
}) {
  const [saved, setSaved] = useState<GameResultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    api.saveGameResult(result).then(setSaved, (err: Error) => setError(err.message));
  }, [result]);
  useConfirmKey(true, onAgain);
  return (
    <section className="game-results" aria-live="polite">
      <p className="game-results__summary">{summary}</p>
      {saved?.newBest && <p className="game-results__best">That's your new best.</p>}
      {error && <p className="error">Couldn't save the result: {error}</p>}
      {children}
      <p className="game-results__actions">
        <button type="button" className="primary-button" onClick={onAgain}>
          Play again <kbd>Space</kbd>
        </button>{" "}
        <a href="#/games" className="link-button">
          All games
        </a>
      </p>
    </section>
  );
}

/** A line from the game with a stretch highlighted (or replaced). */
export function Highlighted({ example, replace, state }: { example: GameExample; replace?: ReactNode; state?: "right" | "wrong" }) {
  const { text, start, end } = example;
  return (
    <>
      {text.slice(0, start)}
      <mark data-state={state}>{replace ?? text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

export function NotEnough({ kind, have, need }: { kind: GameKind; have: number; need: number }) {
  return (
    <section className="box box--empty">
      <p className="line">Not enough material yet.</p>
      <p className="box__hint">
        {GAME_INFO[kind].title} needs at least {need} {GAME_INFO[kind].unit} from your game, and there {have === 1 ? "is" : "are"}{" "}
        {have} so far. Play a bit more, or save some words.
      </p>
      <a href="#/games" className="link-button">
        All games
      </a>
    </section>
  );
}
