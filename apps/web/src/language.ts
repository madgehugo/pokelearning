/** What differs between the languages the app teaches. */
import { wordKey, type Article, type HiddenWord, type Language } from "@pokelearning/shared";

export interface LanguageInfo {
  name: string;
  /** Definite articles in the order of the number keys 1, 2, 3. */
  articles: Article[];
  /** BCP 47 tag for the browser's speech voices. */
  speech: string;
  /** A voice the person can add on a Mac. */
  voiceName: string;
}

export const LANGUAGES: Record<Language, LanguageInfo> = {
  de: { name: "German", articles: ["der", "die", "das"], speech: "de-DE", voiceName: "Anna" },
  es: { name: "Spanish", articles: ["el", "la"], speech: "es-ES", voiceName: "Mónica" },
};

/** The language of a game id: "pokemon-emerald-es" → "es". */
export const languageOfGame = (game: string | null | undefined): Language | null =>
  !game ? null : game.endsWith("-es") ? "es" : "de";

/** Keys of hidden words, for matching against a word in a line. */
export const hiddenKeys = (words: HiddenWord[]): Set<string> => new Set(words.map((w) => wordKey(w.lemma, w.pos, w.lang)));

export const languageOf = (x: { lang?: Language } | undefined): Language => x?.lang ?? "de";

/** The article before a plural: German "die", Spanish "los" or "las" by the singular's gender. */
export function pluralArticle(lang: Language, articles: Article[] | undefined): string {
  if (lang === "de") return "die";
  return articles?.[0] === "la" ? "las" : "los";
}

/** The colour key for an article: Spanish el/la share the masculine and feminine colours. */
export const articleColour = (a: Article): "der" | "die" | "das" => (a === "el" ? "der" : a === "la" ? "die" : a);
