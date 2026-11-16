import { useMemo, useState } from "react";
import type { MatchingPair } from "@pokelearning/shared";
import { NotEnough, Results, seconds, StartScreen, useMaterial, useStopwatch } from "./common.tsx";

const MIN_PAIRS = 4;
/** Same as the server's MATCHING_PENALTY_MS: each wrong pair adds this to your time. */
const PENALTY_MS = 3000;

function shuffled<T>(list: T[]): T[] {
  return [...list].sort(() => Math.random() - 0.5);
}

export function Matching() {
  const [round, setRound] = useState(0);
  const { material, error } = useMaterial("matching", round);
  const [phase, setPhase] = useState<"start" | "playing" | "done">("start");
  const [german, setGerman] = useState<number | null>(null);
  const [english, setEnglish] = useState<number | null>(null);
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [wrongFlash, setWrongFlash] = useState<[number, number] | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const elapsed = useStopwatch(phase === "playing");

  const pairs = material?.pairs ?? [];
  const columns = useMemo(() => ({ left: shuffled(pairs), right: shuffled(pairs) }), [pairs]);

  const tryPair = (g: number | null, e: number | null) => {
    if (g === null || e === null) return;
    if (g === e) {
      const next = new Set(matched).add(g);
      setMatched(next);
      if (next.size === pairs.length) setPhase("done");
    } else {
      setMistakes((n) => n + 1);
      setWrongFlash([g, e]);
      setTimeout(() => setWrongFlash(null), 500);
    }
    setGerman(null);
    setEnglish(null);
  };

  const restart = () => {
    setRound((n) => n + 1);
    setPhase("start");
    setMatched(new Set());
    setMistakes(0);
  };

  if (error) return <p className="error">Couldn't load the game: {error}</p>;
  if (!material) return <p className="muted">Picking words from your game…</p>;
  if (pairs.length < MIN_PAIRS) return <NotEnough kind="matching" have={pairs.length} need={MIN_PAIRS} />;
  if (phase === "start") return <StartScreen kind="matching" onStart={() => setPhase("playing")} />;
  if (phase === "done") {
    const total = elapsed + PENALTY_MS * mistakes;
    return (
      <Results
        result={{ kind: "matching", score: pairs.length, total: pairs.length, durationMs: Math.round(elapsed), mistakes }}
        summary={
          mistakes
            ? `${seconds(total)}: ${seconds(elapsed)} plus ${mistakes} wrong ${mistakes === 1 ? "pair" : "pairs"} × 3 s.`
            : `${seconds(elapsed)}, without a wrong pair.`
        }
        onAgain={restart}
      />
    );
  }

  const cell = (p: MatchingPair, side: "left" | "right") => {
    const selected = side === "left" ? german === p.id : english === p.id;
    const isWrong = wrongFlash !== null && wrongFlash[side === "left" ? 0 : 1] === p.id;
    return (
      <button
        key={`${side}-${p.id}`}
        type="button"
        className="match-cell"
        lang={side === "left" ? "de" : "en"}
        data-gender={side === "left" ? p.gender : undefined}
        aria-pressed={selected}
        data-wrong={isWrong ? "" : undefined}
        disabled={matched.has(p.id)}
        onClick={() => {
          if (side === "left") {
            setGerman(p.id);
            tryPair(p.id, english);
          } else {
            setEnglish(p.id);
            tryPair(german, p.id);
          }
        }}
      >
        {side === "left" ? p.german : p.english}
      </button>
    );
  };

  return (
    <div className="game">
      <div className="game__status">
        <span>
          {matched.size} of {pairs.length} pairs
        </span>
        <span>
          {seconds(elapsed)}
          {mistakes > 0 && ` + ${mistakes} × 3 s`}
        </span>
      </div>
      <div className="match-grid" role="group" aria-label="Match the German words with their meanings">
        <div className="match-column">{columns.left.map((p) => cell(p, "left"))}</div>
        <div className="match-column">{columns.right.map((p) => cell(p, "right"))}</div>
      </div>
    </div>
  );
}
