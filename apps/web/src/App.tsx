import { useEffect, useRef, useState } from "react";
import { Breakdown } from "./components/Breakdown.tsx";
import { DialogueBox } from "./components/DialogueBox.tsx";
import { History } from "./components/History.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { useServer } from "./useServer.ts";
import { wordsOf } from "./words.ts";

export function App() {
  const { lines, status, connection, hasOlder, loadOlder } = useServer();
  /** null = follow the newest line; otherwise the history line being read. */
  const [pinnedId, setPinnedId] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const latest = lines[0];
  const current = (pinnedId !== null && lines.find((l) => l.id === pinnedId)) || latest;
  const following = pinnedId === null || current === latest;

  // Only lines that arrive while you watch print in; the first snapshot appears at once.
  const firstSeenId = useRef<number | null>(null);
  if (firstSeenId.current === null && latest) firstSeenId.current = latest.id;
  const print = following && !!current && current.id !== firstSeenId.current;

  useEffect(() => setSelected(null), [current?.id]);

  // ← → move through the words of the line, Esc closes the details.
  const words = current?.analysis ? wordsOf(current.analysis.tokens) : [];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") setSelected(null);
      if ((e.key !== "ArrowRight" && e.key !== "ArrowLeft") || words.length === 0) return;
      e.preventDefault();
      const pos = words.findIndex((w) => w.index === selected);
      const next = e.key === "ArrowRight" ? (pos + 1) % words.length : (pos <= 0 ? words.length : pos) - 1;
      setSelected(words[next]!.index);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [words, selected]);

  return (
    <div className="app">
      <StatusBar connection={connection} status={status} />
      <main className="reader">
        {!following && (
          <button type="button" className="live-button" onClick={() => setPinnedId(null)}>
            Show the latest line
          </button>
        )}
        <DialogueBox line={current} selected={selected} onSelect={setSelected} print={print} />
        {current && (
          <p className="translation" lang="en">
            {current.translation?.text ?? (status?.translator ? "Translating…" : "No translation for this line.")}
          </p>
        )}
        {current?.analysis && <Breakdown tokens={current.analysis.tokens} selected={selected} onSelect={setSelected} />}
      </main>
      <aside className="side">
        <History
          lines={lines.slice(1)}
          currentId={following ? undefined : current?.id}
          hasOlder={hasOlder}
          onPick={(id) => {
            setPinnedId(id);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onLoadOlder={() => void loadOlder()}
        />
      </aside>
    </div>
  );
}
