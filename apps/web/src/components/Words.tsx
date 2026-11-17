import { useEffect, useState } from "react";
import type { HiddenWord, SavedWord, Settings, WordBankStats } from "@pokelearning/shared";
import { api } from "../api.ts";
import { HiddenList } from "./HiddenList.tsx";
import { languageOf, pluralArticle } from "../language.ts";
import { usePrefs } from "../prefs.ts";
import { genderKey, headword, posLabel, relativeTime, shortGloss } from "../words.ts";

interface Props {
  stats: WordBankStats | undefined;
  hidden: HiddenWord[];
  /** Changes whenever the server reports a word-bank change, to reload the list. */
  version: unknown;
}

const KIND_LABEL = { meaning: "meaning", article: "article", recall: "English → word" } as const;

function statsSentence(s: WordBankStats): string {
  if (s.words === 0) return "Your word bank is empty.";
  const parts = [`${s.words} ${s.words === 1 ? "word" : "words"} in your word bank.`];
  parts.push(s.dueNow === 0 ? "Nothing to review right now." : `${s.dueNow} ${s.dueNow === 1 ? "card" : "cards"} to review now.`);
  if (s.retention30d !== null) {
    parts.push(`You remembered ${Math.round(s.retention30d * 100)}% of ${s.reviews30d} reviews in the last 30 days.`);
  }
  return parts.join(" ");
}

function nextReview(word: SavedWord): string {
  if (word.cards.length === 0) return "No cards";
  if (word.cards.every((c) => c.state === "new")) return "New, not reviewed yet";
  const due = Math.min(...word.cards.filter((c) => c.state !== "new").map((c) => c.due));
  return due <= Date.now() ? "Due now" : `Next review ${relativeTime(due)}`;
}

export function Words({ stats, hidden, version }: Props) {
  const { language } = usePrefs();
  const [words, setWords] = useState<SavedWord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    api.words(language).then(setWords, (err: Error) => setError(err.message));
  }, [version, language]);

  if (error) return <p className="error">Couldn't load your words: {error}</p>;
  if (!words) return <p className="muted">Loading your words…</p>;

  const q = query.trim().toLowerCase();
  const shown = q
    ? words.filter((w) => w.lemma.toLowerCase().includes(q) || w.glosses.some((g) => g.toLowerCase().includes(q)))
    : words;

  return (
    <div className="words-page">
      {stats && <p className="stats">{statsSentence(stats)}</p>}
      {words.length === 0 ? (
        <p className="muted">Open a word in the live view and choose Save word. It will show up here with the sentence it came from.</p>
      ) : (
        <>
          <label className="search">
            <span className="visually-hidden">Search your words</span>
            <input
              type="search"
              placeholder="Search by word or meaning"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <ul className="bank">
            {shown.map((w) => (
              <WordItem
                key={w.id}
                word={w}
                open={open === w.id}
                onToggle={() => setOpen(open === w.id ? null : w.id)}
                onRemoved={() => setWords(words.filter((x) => x.id !== w.id))}
              />
            ))}
          </ul>
          {shown.length === 0 && <p className="muted">No saved word matches “{query}”.</p>}
        </>
      )}
      {hidden.length > 0 && (
        <section>
          <h2>Hidden words</h2>
          <p className="muted">These don't appear in the word list under a line.</p>
          <HiddenList words={hidden} />
        </section>
      )}
      <SettingsForm />
    </div>
  );
}

function WordItem({ word, open, onToggle, onRemoved }: { word: SavedWord; open: boolean; onToggle(): void; onRemoved(): void }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    try {
      await api.removeWord(word.id);
      onRemoved();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <li className="bank__item" data-open={open ? "" : undefined}>
      <button type="button" className="bank__row" aria-expanded={open} onClick={onToggle}>
        <span className="bank__head">
          <span className="headword" lang={languageOf(word)} data-gender={genderKey(word)}>
            {headword(word)}
          </span>{" "}
          <span className="pos">{posLabel(word.pos)}</span> <span className="gloss">{shortGloss(word.glosses[0])}</span>
        </span>
        <span className="bank__meta">
          {word.encounters > 0 && (
            <span>Seen {word.encounters === 1 ? "once" : `${word.encounters} times`} in the game</span>
          )}
          <span>{nextReview(word)}</span>
        </span>
      </button>
      {open && (
        <div className="bank__details">
          {word.glosses.length > 1 && (
            <ol className="glosses">
              {word.glosses.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ol>
          )}
          {word.plural && (
            <p className="grammar">
              Plural: <span lang={languageOf(word)}>{pluralArticle(languageOf(word), word.articles)} {word.plural}</span>.
            </p>
          )}
          {word.contexts.length > 0 && (
            <ul className="examples">
              {word.contexts.map((c) => (
                <li key={c.lineId}>
                  <p className="example" lang={languageOf(word)}>
                    {c.text.slice(0, c.start)}
                    <mark>{c.text.slice(c.start, c.end)}</mark>
                    {c.text.slice(c.end)}
                  </p>
                  {c.translation && <p className="example-translation">{c.translation}</p>}
                </li>
              ))}
            </ul>
          )}
          <p className="muted">
            Cards: {word.cards.map((c) => `${KIND_LABEL[c.kind]} (${c.state})`).join(", ") || "none"}. Saved{" "}
            {relativeTime(word.createdAt) === "now" ? "just now" : relativeTime(word.createdAt)}.
          </p>
          {confirming ? (
            <p>
              Remove <b lang={languageOf(word)}>{headword(word)}</b> and its review history?{" "}
              <button type="button" className="danger-button" onClick={() => void remove()}>
                Remove
              </button>{" "}
              <button type="button" className="link-button" onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </p>
          ) : (
            <button type="button" className="link-button" onClick={() => setConfirming(true)}>
              Remove from word bank
            </button>
          )}
          {error && <p className="error">Couldn't remove it: {error}</p>}
        </div>
      )}
    </li>
  );
}

function SettingsForm() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.settings().then(setSettings, (err: Error) => setError(err.message));
  }, []);
  if (!settings) return null;
  const update = async (patch: Partial<Settings>) => {
    try {
      setSettings(await api.updateSettings(patch));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <section className="settings" aria-labelledby="settings-title">
      <h2 id="settings-title">Review settings</h2>
      <label className="setting">
        <span>New cards per day</span>
        <input
          type="number"
          min={0}
          max={500}
          value={settings.newPerDay}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n >= 0 && n <= 500) void update({ newPerDay: n });
          }}
        />
      </label>
      <label className="setting setting--check">
        <input
          type="checkbox"
          checked={settings.recallCards}
          onChange={(e) => void update({ recallCards: e.target.checked })}
        />
        <span>Also practise English → the game's language (a recall card for every word)</span>
      </label>
      {error && <p className="error">Couldn't save the setting: {error}</p>}
    </section>
  );
}
