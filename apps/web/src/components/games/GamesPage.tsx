import { useEffect, useState } from "react";
import type { GameAvailability, GameKind, GameRecord } from "@pokelearning/shared";
import { api } from "../../api.ts";
import { LANGUAGES } from "../../language.ts";
import { setPrefs, usePrefs } from "../../prefs.ts";
import { ArticleSprint } from "./ArticleSprint.tsx";
import { Cloze } from "./Cloze.tsx";
import { GAME_INFO, seconds } from "./common.tsx";
import { Listening } from "./Listening.tsx";
import { Matching } from "./Matching.tsx";

const ORDER: GameKind[] = ["articles", "cloze", "listening", "matching"];

function bestText(r: GameRecord | undefined): string | null {
  if (!r || r.plays === 0 || r.best === null) return null;
  if (r.kind === "matching") return `Best ${seconds(r.best)}`;
  if (r.kind === "articles") return `Best ${r.best} right`;
  const total = r.last?.total;
  return `Best ${r.best}${total ? ` of ${total}` : ""} right`;
}

export function GamesPage({ game }: { game: GameKind | null }) {
  if (game === "articles") return <ArticleSprint />;
  if (game === "cloze") return <Cloze />;
  if (game === "listening") return <Listening />;
  if (game === "matching") return <Matching />;
  return <GameList />;
}

function GameList() {
  const [data, setData] = useState<{ availability: GameAvailability[]; records: GameRecord[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { language } = usePrefs();
  useEffect(() => {
    setData(null);
    api.games(language).then(setData, (err: Error) => setError(err.message));
  }, [language]);
  if (error) return <p className="error">Couldn't load the games: {error}</p>;
  if (!data) return <p className="muted">Loading games…</p>;
  return (
    <div className="games">
      <p className="stats">Practice with words and lines from your own game. Games don't change your review schedule.</p>
      <ul className="game-list">
        {ORDER.map((kind) => {
          const a = data.availability.find((x) => x.kind === kind);
          const r = data.records.find((x) => x.kind === kind);
          const ready = !!a && a.available >= a.needed;
          const best = bestText(r);
          return (
            <li key={kind} className="game-list__item">
              <div>
                <h2>{GAME_INFO[kind].title}</h2>
                <p>{GAME_INFO[kind].blurb}</p>
                <p className="muted">
                  {ready
                    ? [best, r && r.plays ? `played ${r.plays} ${r.plays === 1 ? "time" : "times"}` : "not played yet"]
                        .filter(Boolean)
                        .join(", ")
                    : `Needs ${a?.needed} ${GAME_INFO[kind].unit} from your game; ${a?.available ?? 0} so far.`}
                </p>
              </div>
              {ready ? (
                <a className="primary-button" href={`#/games/${kind}`}>
                  Play
                </a>
              ) : (
                <span className="muted">Play more first</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
