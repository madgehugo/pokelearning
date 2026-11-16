import type { ServerStatus } from "@pokelearning/shared";
import type { Route } from "../App.tsx";
import type { Connection } from "../useServer.ts";
import { GAME_NAMES } from "../words.ts";

interface Props {
  connection: Connection;
  status: ServerStatus | null;
  route: Route;
  /** Cards to review now. */
  due: number;
}

function describe({ connection, status }: Pick<Props, "connection" | "status">): { state: "live" | "waiting" | "offline"; text: string } {
  if (connection === "offline") return { state: "offline", text: "Server not running. Start it with npm run dev." };
  if (connection === "connecting" || !status) return { state: "waiting", text: "Connecting to the server…" };
  if (status.adapters === 0) return { state: "waiting", text: "Waiting for mGBA. Load adapters/mgba-lua/main.lua." };
  const game = status.game ? (GAME_NAMES[status.game] ?? status.game) : "the game";
  return { state: "live", text: `Following ${game}` };
}

export function StatusBar(props: Props) {
  const { state, text } = describe(props);
  const translationOff = props.connection === "open" && props.status && !props.status.translator;
  const link = (to: Route, label: string, extra?: string) => (
    <a href={`#/${to === "live" ? "" : to}`} aria-current={props.route === to ? "page" : undefined}>
      {label}
      {extra && <span className="nav__count">{extra}</span>}
    </a>
  );
  return (
    <header className="topbar">
      <div className="topbar__main">
        <span className="brand">Pokélearning</span>
        <nav className="nav" aria-label="Sections">
          {link("live", "Live")}
          {link("review", "Review", props.due > 0 ? String(props.due) : undefined)}
          {link("words", "Words")}
          {link("games", "Games")}
        </nav>
      </div>
      <p className="status" data-state={state} role="status">
        <span className="status__dot" aria-hidden="true" />
        {text}
        {translationOff && <span className="status__extra"> Translation is loading or off.</span>}
      </p>
    </header>
  );
}
