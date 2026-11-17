import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Article, ArticleItem } from "@pokelearning/shared";
import { articleColour, LANGUAGES, pluralArticle } from "../../language.ts";
import { Highlighted, NotEnough, Results, StartScreen, useMaterial, useNumberKeys, useStopwatch } from "./common.tsx";

const DURATION_MS = 60_000;
const MIN_ITEMS = 10;
/** How long a wrong answer stays on screen with the right article. */
const WRONG_PAUSE_MS = 900;

type Phase = "start" | "playing" | "done";

export function ArticleSprint() {
  const [round, setRound] = useState(0);
  const { material, error } = useMaterial("articles", round);
  const lang = material?.lang ?? "de";
  const ARTICLES = LANGUAGES[lang].articles;
  const [phase, setPhase] = useState<Phase>("start");
  const [index, setIndex] = useState(0);
  const [right, setRight] = useState(0);
  const [wrong, setWrong] = useState<{ item: ArticleItem; picked: Article }[]>([]);
  const [feedback, setFeedback] = useState<{ picked: Article; ok: boolean } | null>(null);
  const elapsed = useStopwatch(phase === "playing");
  const pauseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // the list repeats in a new order if you get through it before time runs out
  const items = useMemo(() => {
    const list = material?.items ?? [];
    return list.length ? Array.from({ length: 6 }, () => [...list].sort(() => Math.random() - 0.5)).flat() : [];
  }, [material]);
  const item = items[index];

  useEffect(() => {
    if (phase === "playing" && elapsed >= DURATION_MS) {
      clearTimeout(pauseTimer.current);
      setFeedback(null);
      setPhase("done");
    }
  }, [elapsed, phase]);
  useEffect(() => () => clearTimeout(pauseTimer.current), []);

  const pick = useCallback(
    (a: Article) => {
      if (phase !== "playing" || !item || feedback) return;
      const ok = a === item.article;
      setFeedback({ picked: a, ok });
      if (ok) setRight((n) => n + 1);
      else setWrong((list) => [...list, { item, picked: a }]);
      pauseTimer.current = setTimeout(
        () => {
          setFeedback(null);
          setIndex((i) => i + 1);
        },
        ok ? 150 : WRONG_PAUSE_MS,
      );
    },
    [phase, item, feedback],
  );
  useNumberKeys(phase === "playing", ARTICLES.length, (i) => pick(ARTICLES[i]!));

  const restart = () => {
    setRound((r) => r + 1);
    setPhase("start");
    setIndex(0);
    setRight(0);
    setWrong([]);
  };

  if (error) return <p className="error">Couldn't load the game: {error}</p>;
  if (!material) return <p className="muted">Picking nouns from your game…</p>;
  if (material.items.length < MIN_ITEMS) return <NotEnough kind="articles" have={material.items.length} need={MIN_ITEMS} />;

  if (phase === "start") {
    return <StartScreen kind="articles" onStart={() => setPhase("playing")} />;
  }

  if (phase === "done") {
    const total = right + wrong.length;
    return (
      <Results
        result={{ kind: "articles", score: right, total, durationMs: DURATION_MS, mistakes: wrong.length }}
        summary={`Time's up. ${right} right${wrong.length ? `, ${wrong.length} wrong` : ""}.`}
        onAgain={restart}
      >
        {wrong.length > 0 && (
          <div className="mistakes">
            <p className="muted">To remember:</p>
            <ul>
              {[...new Map(wrong.map((w) => [w.item.lemma, w])).values()].map(({ item: w, picked }) => (
                <li key={w.lemma}>
                  <b lang={lang} data-gender={articleColour(w.article)}>
                    {w.article} {w.lemma}
                  </b>
                  {w.plural && <span className="muted"> ({pluralArticle(lang, [w.article])} {w.plural})</span>} {w.gloss}
                  <span className="muted">. You picked {picked}.</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Results>
    );
  }

  const left = Math.max(0, DURATION_MS - elapsed);
  return (
    <div className="game">
      <div className="game__status">
        <span>{right} right</span>
        <span aria-label={`${Math.ceil(left / 1000)} seconds left`}>{Math.ceil(left / 1000)} s</span>
      </div>
      <div className="timer" aria-hidden="true">
        <div className="timer__bar" style={{ transform: `scaleX(${left / DURATION_MS})` }} />
      </div>
      <section className="box review__card" data-flash={feedback ? (feedback.ok ? "right" : "wrong") : undefined}>
        {item && (
          <>
            <p className="card-word" lang={lang}>
              {feedback ? (
                <span data-gender={articleColour(item.article)}>
                  {item.article} {item.lemma}
                </span>
              ) : (
                <>
                  <span className="blank">___</span> {item.lemma}
                </>
              )}
            </p>
            <p className="pos">{item.gloss}</p>
            {feedback && !feedback.ok && item.example && (
              <p className="example" lang={lang}>
                <Highlighted example={item.example} />
              </p>
            )}
          </>
        )}
      </section>
      <div className="choice review__actions" role="group" aria-label="Which article?">
        {ARTICLES.map((a, i) => (
          <button
            key={a}
            type="button"
            className="choice__button"
            data-gender={articleColour(a)}
            data-picked={feedback?.picked === a ? "" : undefined}
            onClick={() => pick(a)}
          >
            {a} <kbd>{i + 1}</kbd>
          </button>
        ))}
      </div>
    </div>
  );
}
