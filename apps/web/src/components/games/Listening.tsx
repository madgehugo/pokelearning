import { useCallback, useEffect, useState } from "react";
import type { Language } from "@pokelearning/shared";
import { LANGUAGES } from "../../language.ts";
import { usePrefs } from "../../prefs.ts";
import { NotEnough, Results, StartScreen, useConfirmKey, useMaterial, useNumberKeys, useStopwatch } from "./common.tsx";

const MIN_ROUNDS = 4;

/** The browser's voices for a language (Web Speech API); they load asynchronously. */
function useVoice(lang: Language): { voice: SpeechSynthesisVoice | null; supported: boolean; loaded: boolean } {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => (supported ? speechSynthesis.getVoices() : []));
  useEffect(() => {
    if (!supported) return;
    const update = () => setVoices(speechSynthesis.getVoices());
    speechSynthesis.addEventListener("voiceschanged", update);
    update();
    return () => speechSynthesis.removeEventListener("voiceschanged", update);
  }, [supported]);
  const { speech } = LANGUAGES[lang];
  const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
  // prefer a voice for the home country (Germany, Spain), and a local one (works offline)
  const voice =
    matching.find((v) => v.lang.replace("_", "-") === speech && v.localService) ?? matching.find((v) => v.lang.replace("_", "-") === speech) ?? matching[0] ?? null;
  return { voice, supported, loaded: voices.length > 0 };
}

function speak(text: string, voice: SpeechSynthesisVoice, rate: number) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = rate;
  speechSynthesis.speak(u);
}

export function Listening() {
  const [round, setRound] = useState(0);
  const { material, error } = useMaterial("listening", round);
  const lang = usePrefs().language;
  const { voice, supported, loaded } = useVoice(lang);
  const [phase, setPhase] = useState<"start" | "playing" | "done">("start");
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [right, setRight] = useState(0);
  const [replays, setReplays] = useState(0);
  const elapsed = useStopwatch(phase === "playing");

  const rounds = material?.rounds ?? [];
  const r = rounds[index];

  // Game text is in Gen 3 capitals; a voice reads "FLEMMLI" better as "Flemmli".
  const spoken = r ? r.text.replace(/\p{Lu}{2,}[\p{L}]*/gu, (w) => w.charAt(0) + w.slice(1).toLowerCase()) : "";
  const play = useCallback(
    (rate = 0.95) => {
      if (!voice || !spoken) return;
      speak(spoken, voice, rate);
    },
    [voice, spoken],
  );
  useEffect(() => {
    if (phase === "playing") play();
  }, [phase, index, play]);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

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
    if (index + 1 >= rounds.length) setPhase("done");
    else setIndex(index + 1);
  }, [picked, index, rounds.length]);

  useNumberKeys(phase === "playing" && picked === null, r?.options.length ?? 0, (i) => pick(r!.options[i]!));
  useConfirmKey(phase === "playing" && picked !== null, next);
  useEffect(() => {
    if (phase !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r" || e.key === "R") {
        setReplays((n) => n + 1);
        play(e.shiftKey ? 0.7 : 0.95);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, play]);

  const restart = () => {
    setRound((n) => n + 1);
    setPhase("start");
    setIndex(0);
    setRight(0);
    setPicked(null);
    setReplays(0);
  };

  if (error) return <p className="error">Couldn't load the game: {error}</p>;
  if (!material) return <p className="muted">Picking lines from your game…</p>;
  if (rounds.length < MIN_ROUNDS) return <NotEnough kind="listening" have={rounds.length} need={MIN_ROUNDS} />;
  if (!supported || (loaded && !voice)) {
    return (
      <section className="box box--empty">
        <p className="line">This browser has no {LANGUAGES[lang].name} voice.</p>
        <p className="box__hint">
          On a Mac: System Settings → Accessibility → Spoken Content → System voice → Manage voices, and add a {LANGUAGES[lang].name}
          voice such as {LANGUAGES[lang].voiceName}. On a phone, add a {LANGUAGES[lang].name} voice in the text-to-speech settings. Then reload this page.
        </p>
        <a href="#/games" className="link-button">
          All games
        </a>
      </section>
    );
  }
  if (phase === "start") {
    return (
      <StartScreen
        kind="listening"
        onStart={() => setPhase("playing")}
        extra={voice && <p className="muted">Voice: {voice.name}. Press R to hear a line again, Shift+R for slower.</p>}
      />
    );
  }
  if (phase === "done") {
    return (
      <Results
        result={{ kind: "listening", score: right, total: rounds.length, durationMs: elapsed, mistakes: rounds.length - right }}
        summary={`${right} of ${rounds.length} right${replays ? `, with ${replays} ${replays === 1 ? "replay" : "replays"}` : ""}.`}
        onAgain={restart}
      />
    );
  }

  const answered = picked !== null;
  return (
    <div className="game">
      <div className="game__status">
        <span>
          Line {index + 1} of {rounds.length}
        </span>
        <span>{right} right</span>
      </div>
      <section className="box review__card">
        {answered ? (
          <p className="example example--big" lang={lang}>
            {r!.text}
          </p>
        ) : (
          <p className="box__hint">Listen, then pick what it means.</p>
        )}
        <p className="listen-controls">
          <button type="button" className="save-button" onClick={() => (setReplays((n) => n + 1), play())}>
            Hear it again <kbd>R</kbd>
          </button>{" "}
          <button type="button" className="link-button" onClick={() => (setReplays((n) => n + 1), play(0.7))}>
            Slower
          </button>
        </p>
        {answered && (
          <p className="verdict" data-right={picked === r!.answer ? "" : undefined}>
            {picked === r!.answer ? "Right." : `It means: ${r!.answer}`}
          </p>
        )}
      </section>
      <div className="review__actions">
        {!answered ? (
          <div className="options options--stacked" role="group" aria-label="What does it mean?">
            {r!.options.map((o, i) => (
              <button key={o} type="button" className="option-button" onClick={() => pick(o)}>
                {o} <kbd>{i + 1}</kbd>
              </button>
            ))}
          </div>
        ) : (
          <button type="button" className="primary-button" onClick={next}>
            {index + 1 >= rounds.length ? "See results" : "Next line"} <kbd>Space</kbd>
          </button>
        )}
      </div>
    </div>
  );
}
