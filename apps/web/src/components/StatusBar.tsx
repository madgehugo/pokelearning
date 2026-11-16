import type { ServerStatus } from "@pokelearning/shared";
import type { Connection } from "../useServer.ts";
import { GAME_NAMES } from "../words.ts";

interface Props {
  connection: Connection;
  status: ServerStatus | null;
}

function describe({ connection, status }: Props): { state: "live" | "waiting" | "offline"; text: string } {
  if (connection === "offline") return { state: "offline", text: "Server not running. Start it with npm run dev." };
  if (connection === "connecting" || !status) return { state: "waiting", text: "Connecting to the server…" };
  if (status.adapters === 0) return { state: "waiting", text: "Waiting for mGBA. Load adapters/mgba-lua/main.lua." };
  const game = status.game ? (GAME_NAMES[status.game] ?? status.game) : "the game";
  return { state: "live", text: `Following ${game}` };
}

export function StatusBar(props: Props) {
  const { state, text } = describe(props);
  const translationOff = props.connection === "open" && props.status && !props.status.translator;
  return (
    <header className="topbar">
      <span className="brand">Pokélearning</span>
      <p className="status" data-state={state} role="status">
        <span className="status__dot" aria-hidden="true" />
        {text}
        {translationOff && <span className="status__extra"> Translation is loading or off.</span>}
      </p>
    </header>
  );
}
