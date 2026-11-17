import type { Language } from "@pokelearning/shared";
import { LANGUAGES } from "../language.ts";
import { setPrefs, usePrefs } from "../prefs.ts";

/** Which language you study: Review, Words, Games and the hidden words show only that language's content. */
export function LanguageSwitch() {
  const { language } = usePrefs();
  return (
    <div className="choice choice--compact" role="group" aria-label="Language you study">
      {(Object.keys(LANGUAGES) as Language[]).map((l) => (
        <button key={l} type="button" className="choice__button" aria-pressed={language === l} onClick={() => setPrefs({ language: l })}>
          {LANGUAGES[l].name}
        </button>
      ))}
    </div>
  );
}
