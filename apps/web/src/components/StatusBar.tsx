import type { ServerStatus, SetupStatus } from "@pokelearning/shared";
import type { Route } from "../App.tsx";
import { setupNote, type Connection } from "../useServer.ts";
import { gameName } from "../words.ts";
import { LanguageSwitch } from "./LanguageSwitch.tsx";
import { PrefsMenu } from "./PrefsMenu.tsx";

interface Props {
  connection: Connection;
  status: ServerStatus | null;
  setup: SetupStatus | null;
  route: Route;
  /** Cards to review now. */
  due: number;
}

function describe({ connection, status }: Pick<Props, "connection" | "status">): { state: "live" | "waiting" | "offline"; text: string } {
  if (connection === "offline") return { state: "offline", text: "Server not running. Start it with npm run play." };
  if (connection === "connecting" || !status) return { state: "waiting", text: "Connecting to the server…" };
  if (status.adapters === 0) return { state: "waiting", text: "Waiting for mGBA. Load adapters/mgba-lua/main.lua." };
  if (status.adapterWarning) return { state: "waiting", text: status.adapterWarning };
  const game = status.game ? gameName(status.game) : "the game";
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
        <span className="brand">
          <img className="brand__logo" src="/icon.svg" alt="" width="28" height="28" />
          Pokélearning
        </span>
        <nav className="nav" aria-label="Sections">
          {link("live", "Live")}
          {link("review", "Review", props.due > 0 ? String(props.due) : undefined)}
          {link("words", "Words")}
          {link("games", "Games")}
        </nav>
        <LanguageSwitch />
      </div>
      <p className="status" data-state={state} role="status">
        <span className="status__dot" aria-hidden="true" />
        {text}
        {setupNote(props.setup) ? (
          <span className="status__extra"> {setupNote(props.setup)}</span>
        ) : (
          translationOff && <span className="status__extra"> Translation is loading or off.</span>
        )}
      </p>
      {props.status?.update && (
        <a className="update" href={props.status.update.url} target="_blank" rel="noreferrer">
          Update {props.status.update.version}
        </a>
      )}
      <PrefsMenu />
    </header>
  );
}
