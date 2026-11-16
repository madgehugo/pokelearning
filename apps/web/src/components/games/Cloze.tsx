import { useCallback, useState } from "react";
import { Highlighted, NotEnough, Results, StartScreen, useConfirmKey, useMaterial, useNumberKeys, useStopwatch } from "./common.tsx";

const MIN_ROUNDS = 4;

export function Cloze() {
  const [round, setRound] = useState(0);
  const { material, error } = useMaterial("cloze", round);
  const [phase, setPhase] = useState<"start" | "playing" | "done">("start");
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const [right, setRight] = useState(0);
  const elapsed = useStopwatch(phase === "playing");

  const rounds = material?.rounds ?? [];
  const r = rounds[index];

  const pick = useCallback(
    (option: string) => {
      if (!r || picked !== null) return;
      setPicked(option);
      if (option === r.answer) setRight((n) => n + 1);
    },
    [r, picked],
  );
  const next = useCallback(() => {
    if (picked === null) return;
    setPicked(null);
    setHint(false);
    if (index + 1 >= rounds.length) setPhase("done");
    else setIndex(index + 1);
  }, [picked, index, rounds.length]);

  useNumberKeys(phase === "playing" && picked === null, r?.options.length ?? 0, (i) => pick(r!.options[i]!));
  useConfirmKey(phase === "playing" && picked !== null, next);

  const restart = () => {
    setRound((n) => n + 1);
    setPhase("start");
    setIndex(0);
    setRight(0);
    setPicked(null);
  };

  if (error) return <p className="error">Couldn't load the game: {error}</p>;
  if (!material) return <p className="muted">Picking lines from your game…</p>;
  if (rounds.length < MIN_ROUNDS) return <NotEnough kind="cloze" have={rounds.length} need={MIN_ROUNDS} />;
  if (phase === "start") return <StartScreen kind="cloze" onStart={() => setPhase("playing")} />;
  if (phase === "done") {
    return (
      <Results
        result={{ kind: "cloze", score: right, total: rounds.length, durationMs: elapsed, mistakes: rounds.length - right }}
        summary={`${right} of ${rounds.length} right.`}
        onAgain={restart}
      />
    );
  }

  const answered = picked !== null;
  const ok = picked === r!.answer;
  return (
    <div className="game">
      <div className="game__status">
        <span>
          Line {index + 1} of {rounds.length}
        </span>
        <span>{right} right</span>
      </div>
      <section className="box review__card">
        <p className="example example--big" lang="de">
          <Highlighted
            example={{ text: r!.text, translation: r!.translation, start: r!.start, end: r!.end }}
            replace={answered ? r!.answer : "______"}
            state={answered ? (ok ? "right" : "wrong") : undefined}
          />
        </p>
        {(answered || hint) && r!.translation && <p className="example-translation">{r!.translation}</p>}
        {answered && (
          <p className="verdict" data-right={ok ? "" : undefined}>
            {ok ? "Right." : `It's “${r!.answer}”, not “${picked}”.`}{" "}
            <span className="muted">
              <span lang="de">{r!.lemma}</span>: {r!.gloss}
            </span>
          </p>
        )}
      </section>
      <div className="review__actions">
        {!answered ? (
          <>
            <div className="options" role="group" aria-label="Which word fits?">
              {r!.options.map((o, i) => (
                <button key={o} type="button" className="option-button" lang="de" onClick={() => pick(o)}>
                  {o} <kbd>{i + 1}</kbd>
                </button>
              ))}
            </div>
            {!hint && r!.translation && (
              <button type="button" className="link-button" onClick={() => setHint(true)}>
                Show the translation
              </button>
            )}
          </>
        ) : (
          <button type="button" className="primary-button" onClick={next}>
            {index + 1 >= rounds.length ? "See results" : "Next line"} <kbd>Space</kbd>
          </button>
        )}
      </div>
    </div>
  );
}
