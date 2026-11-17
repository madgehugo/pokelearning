import { useCallback, useEffect, useRef, useState } from "react";
import type { Article, Grade, Language, ReviewItem, ReviewQueue, SavedWord, WordContext } from "@pokelearning/shared";
import { api } from "../api.ts";
import { usePrefs } from "../prefs.ts";
import { articleColour, LANGUAGES, languageOf, pluralArticle } from "../language.ts";
import { genderKey, headword, posLabel, relativeTime, shortGloss } from "../words.ts";

const GRADES: { grade: Grade; label: string }[] = [
  { grade: 1, label: "Again" },
  { grade: 2, label: "Hard" },
  { grade: 3, label: "Good" },
  { grade: 4, label: "Easy" },
];

export function Review() {
  const { language: study } = usePrefs();
  const [queue, setQueue] = useState<ReviewQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [picked, setPicked] = useState<Article | null>(null);
  const [busy, setBusy] = useState(false);
  const shownAt = useRef(Date.now());

  const load = useCallback(async () => {
    try {
      setQueue(await api.queue(study));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [study]);
  useEffect(() => void load(), [load]);

  const item = queue?.items[0];
  useEffect(() => {
    setRevealed(false);
    setPicked(null);
    shownAt.current = Date.now();
  }, [item?.card.id, item?.card.due]);

  const answer = useCallback(
    async (grade: Grade) => {
      if (!item || busy) return;
      setBusy(true);
      try {
        setQueue(await api.answer(item.card.id, { grade, durationMs: Date.now() - shownAt.current }, study));
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [item, busy, study],
  );

  const undo = useCallback(async () => {
    if (!queue?.canUndo || busy) return;
    setBusy(true);
    try {
      setQueue(await api.undo(study));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [queue?.canUndo, busy, study]);

  const lang = languageOf(item?.word);
  const ARTICLES = LANGUAGES[lang].articles;
  const isArticle = item?.card.kind === "article";
  const correctArticle = item?.word.articles?.[0];
  const pick = useCallback((a: Article) => {
    setPicked(a);
    setRevealed(true);
  }, []);

  // Space shows the answer (or continues after an article), 1–4 grade, 1–3 pick an article.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.target instanceof HTMLInputElement) return;
      if (e.key === "z") return void undo();
      if (!item) return;
      const n = Number(e.key);
      if (isArticle && !revealed && n >= 1 && n <= ARTICLES.length) return pick(ARTICLES[n - 1]!);
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (isArticle && !revealed) return; // pick the article first
        if (!revealed) setRevealed(true);
        else if (isArticle) void answer(picked === correctArticle ? 3 : 1);
        return;
      }
      if (revealed && !isArticle && ["1", "2", "3", "4"].includes(e.key)) void answer(Number(e.key) as Grade);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, revealed, isArticle, picked, correctArticle, answer, pick, undo]);

  if (error && !queue) return <p className="error">Couldn't load the reviews: {error}</p>;
  if (!queue) return <p className="muted">Loading reviews…</p>;

  const undoButton = queue.canUndo && (
    <button type="button" className="undo-button" disabled={busy} onClick={() => void undo()}>
      Undo last answer <kbd>Z</kbd>
    </button>
  );

  if (!item) {
    return (
      <>
        <section className="box box--empty review-done" aria-live="polite">
          <p className="line">Nothing to review right now.</p>
          <p className="box__hint">
            {queue.nextDue
              ? `The next card is due ${relativeTime(queue.nextDue)}.`
              : "Save words from the game to review them here: open a word in the live view and choose Save word."}
          </p>
        </section>
        {undoButton}
      </>
    );
  }

  const left = queue.due + queue.newAvailable;
  return (
    <div className="review">
      <p className="review__count" aria-live="polite">
        {left <= 1 ? "Last card for now." : `${left} cards left.`}{" "}
        {item.card.state === "new" && <span className="muted">This one is new.</span>}
      </p>
      <section className="box review__card" aria-label="Card">
        {item.card.kind === "meaning" && <MeaningFront item={item} />}
        {item.card.kind === "recall" && <RecallFront word={item.word} revealed={revealed} />}
        {isArticle && <ArticleFront word={item.word} picked={picked} />}
        {revealed && <Back item={item} picked={picked} />}
      </section>

      <div className="review__actions">
        {isArticle && !revealed && (
          <div className="choice" role="group" aria-label="Which article?">
            {ARTICLES.map((a, i) => (
              <button key={a} type="button" className="choice__button" data-gender={articleColour(a)} onClick={() => pick(a)}>
                {a} <kbd>{i + 1}</kbd>
              </button>
            ))}
          </div>
        )}
        {isArticle && revealed && (
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={() => void answer(picked === correctArticle ? 3 : 1)}
          >
            Next card <kbd>Space</kbd>
          </button>
        )}
        {!isArticle && !revealed && (
          <button type="button" className="primary-button" onClick={() => setRevealed(true)}>
            Show answer <kbd>Space</kbd>
          </button>
        )}
        {!isArticle && revealed && (
          <div className="grades" role="group" aria-label="How well did you know it?">
            {GRADES.map(({ grade, label }) => (
              <button
                key={grade}
                type="button"
                className="grade-button"
                data-grade={grade}
                disabled={busy}
                onClick={() => void answer(grade)}
              >
                <span>{label}</span>
                <span className="grade-button__when">{item.intervals[grade]}</span>
                <kbd>{grade}</kbd>
              </button>
            ))}
          </div>
        )}
      </div>
      {undoButton}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** The example sentence from the game, with the word highlighted. */
function Example({ context, lang }: { context: WordContext | undefined; lang: Language }) {
  if (!context) return null;
  const { text, start, end } = context;
  return (
    <p className="example" lang={lang}>
      {text.slice(0, start)}
      <mark>{text.slice(start, end)}</mark>
      {text.slice(end)}
    </p>
  );
}

function MeaningFront({ item }: { item: ReviewItem }) {
  const w = item.word;
  return (
    <>
      <p className="card-word" lang={languageOf(w)}>
        <span data-gender={genderKey(w)}>{headword(w)}</span>
      </p>
      <p className="pos">{posLabel(w.pos)}</p>
      <Example context={w.contexts[0]} lang={languageOf(w)} />
    </>
  );
}

function RecallFront({ word, revealed }: { word: SavedWord; revealed: boolean }) {
  return (
    <>
      <p className="card-word card-word--english">{word.glosses.slice(0, 2).map(shortGloss).join("; ")}</p>
      <p className="pos">
        {posLabel(word.pos)}
        {!revealed && `. What's the ${LANGUAGES[languageOf(word)].name} word?`}
      </p>
    </>
  );
}

function ArticleFront({ word, picked }: { word: SavedWord; picked: Article | null }) {
  const right = word.articles?.[0];
  return (
    <>
      <p className="card-word" lang={languageOf(word)}>
        {picked ? (
          <span data-gender={right && articleColour(right)}>
            {right} {word.lemma}
          </span>
        ) : (
          <>
            <span className="blank" aria-label="which article">
              ___
            </span>{" "}
            {word.lemma}
          </>
        )}
      </p>
      <p className="pos">{shortGloss(word.glosses[0])}</p>
      {picked && (
        <p className="verdict" data-right={picked === right ? "" : undefined}>
          {picked === right ? "Right." : `Not ${picked}: it's ${right} ${word.lemma}.`}
        </p>
      )}
    </>
  );
}

function Back({ item, picked }: { item: ReviewItem; picked: Article | null }) {
  const w = item.word;
  const context = w.contexts[0];
  return (
    <div className="card-back">
      {item.card.kind === "recall" && (
        <p className="card-word" lang={languageOf(w)}>
          <span data-gender={genderKey(w)}>{headword(w)}</span>
        </p>
      )}
      {item.card.kind !== "article" &&
        (w.glosses.length > 1 ? (
          <ol className="glosses">
            {w.glosses.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ol>
        ) : (
          <p className="glosses">{w.glosses[0]}</p>
        ))}
      {w.plural && (
        <p className="grammar">
          Plural: <span lang={languageOf(w)}>{pluralArticle(languageOf(w), w.articles)} {w.plural}</span>.
        </p>
      )}
      {(item.card.kind !== "meaning" || picked) && <Example context={context} lang={languageOf(w)} />}
      {context?.translation && <p className="example-translation">{context.translation}</p>}
    </div>
  );
}
