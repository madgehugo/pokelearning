/**
 * The compact view for the side panel next to mGBA (apps/panel-macos, or any
 * narrow window at #/panel): the current line, its translation and its words,
 * with saving. Review, Words and Games open on the full website.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { wordKey, type ProcessedLine } from "@pokelearning/shared";
import type { useServer } from "../useServer.ts";
import { Breakdown } from "./Breakdown.tsx";
import { DialogueBox } from "./DialogueBox.tsx";
import { HiddenList } from "./HiddenList.tsx";

type Server = ReturnType<typeof useServer>;

/** The native panel exposes a message handler; in a normal browser there is none. */
interface PanelBridge {
  postMessage(message: string): void;
}
const bridge = (): PanelBridge | undefined =>
  (window as unknown as { webkit?: { messageHandlers?: { panel?: PanelBridge } } }).webkit?.messageHandlers?.panel;

function state(server: Server): { state: "live" | "waiting" | "offline"; text: string } {
  if (server.connection === "offline") return { state: "offline", text: "Server not running" };
  if (!server.status || server.connection === "connecting") return { state: "waiting", text: "Connecting…" };
  if (server.status.adapters === 0) return { state: "waiting", text: "Load the script in mGBA" };
  if (server.status.adapterWarning) return { state: "waiting", text: "mGBA script out of date: reload it" };
  return { state: "live", text: "Live" };
}

export function Panel({ server }: { server: Server }) {
  const { lines, status, wordbank } = server;
  const saved = useMemo(() => new Set(wordbank?.saved ?? []), [wordbank]);
  const hiddenWords = wordbank?.hidden ?? [];
  const hidden = useMemo(() => new Set(hiddenWords.map((w) => wordKey(w.lemma, w.pos))), [hiddenWords]);
  const [showHidden, setShowHidden] = useState(false);
  const [offset, setOffset] = useState(0); // 0 = newest line; ← and → in the header step through earlier ones
  const [selected, setSelected] = useState<number | null>(null);
  const line: ProcessedLine | undefined = lines[offset];
  const due = wordbank?.stats.dueNow ?? 0;
  const s = state(server);

  // a new line comes in: back to it, unless you are reading an earlier one
  const newest = lines[0]?.id;
  const lastNewest = useRef(newest);
  useEffect(() => {
    if (newest !== lastNewest.current && offset === 0) setSelected(null);
    lastNewest.current = newest;
  }, [newest, offset]);
  useEffect(() => setSelected(null), [line?.id]);

  const firstSeen = useRef<number | null>(null);
  if (firstSeen.current === null && lines[0]) firstSeen.current = lines[0].id;
  const print = offset === 0 && !!line && line.id !== firstSeen.current;

  const site = `${location.origin}/#/`;
  return (
    <div className="panel">
      <header className="panel__top">
        <p className="status" data-state={s.state} role="status">
          <span className="status__dot" aria-hidden="true" />
          {s.text}
        </p>
        <nav className="panel__nav" aria-label="Lines">
          <button
            type="button"
            className="link-button"
            disabled={offset >= lines.length - 1}
            onClick={() => setOffset(offset + 1)}
            aria-label="Earlier line"
          >
            ‹ Earlier
          </button>
          {offset > 0 && (
            <button type="button" className="link-button" onClick={() => setOffset(0)}>
              Latest ›
            </button>
          )}
          {bridge() && (
            <button type="button" className="link-button" onClick={() => bridge()!.postMessage("dock")}>
              Dock
            </button>
          )}
        </nav>
      </header>

      <DialogueBox line={line} selected={selected} onSelect={setSelected} print={print} saved={saved} hidden={hidden} />
      {line && (
        <p className="translation" lang="en">
          {line.translation?.text ?? (status?.translator ? "Translating…" : "No translation for this line.")}
        </p>
      )}
      {line?.analysis && (
        <Breakdown lineId={line.id} tokens={line.analysis.tokens} selected={selected} onSelect={setSelected} saved={saved} hidden={hidden} />
      )}
      {showHidden && <HiddenList words={hiddenWords} />}

      <footer className="panel__links">
        <a href={`${site}review`} target="_blank" rel="noreferrer">
          Review{due > 0 && <span className="nav__count">{due}</span>}
        </a>
        <a href={`${site}words`} target="_blank" rel="noreferrer">
          Words
        </a>
        <a href={`${site}games`} target="_blank" rel="noreferrer">
          Games
        </a>
        {hiddenWords.length > 0 && (
          <button type="button" className="link-button" aria-expanded={showHidden} onClick={() => setShowHidden(!showHidden)}>
            Hidden ({hiddenWords.length})
          </button>
        )}
      </footer>
    </div>
  );
}
