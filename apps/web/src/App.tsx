import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Breakdown } from "./components/Breakdown.tsx";
import { DialogueBox } from "./components/DialogueBox.tsx";
import { History } from "./components/History.tsx";
import { Review } from "./components/Review.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { Words } from "./components/Words.tsx";
import { useServer } from "./useServer.ts";
import { wordsOf } from "./words.ts";

export type Route = "live" | "review" | "words";

function routeFromHash(): Route {
  const h = location.hash.replace(/^#\/?/, "");
  return h === "review" || h === "words" ? h : "live";
}

function useRoute(): Route {
  const [route, setRoute] = useState(routeFromHash);
  useEffect(() => {
    const onHash = () => {
      setRoute(routeFromHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

export function App() {
  const route = useRoute();
  const { lines, status, connection, hasOlder, loadOlder, wordbank } = useServer();
  const saved = useMemo(() => new Set(wordbank?.saved ?? []), [wordbank]);
  const due = wordbank?.stats.dueNow ?? 0;
  const top = <StatusBar connection={connection} status={status} route={route} due={due} />;

  if (route !== "live") {
    return (
      <div className="app app--single">
        {top}
        <main className="reader">
          {route === "review" ? <Review /> : <Words stats={wordbank?.stats} version={wordbank} />}
        </main>
      </div>
    );
  }
  return <Live top={top} {...{ lines, status, hasOlder, loadOlder, saved }} />;
}

interface LiveProps {
  top: ReactNode;
  lines: ReturnType<typeof useServer>["lines"];
  status: ReturnType<typeof useServer>["status"];
  hasOlder: boolean;
  loadOlder(): Promise<void>;
  saved: Set<string>;
}

function Live({ top, lines, status, hasOlder, loadOlder, saved }: LiveProps) {
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
      {top}
      <main className="reader">
        {!following && (
          <button type="button" className="live-button" onClick={() => setPinnedId(null)}>
            Show the latest line
          </button>
        )}
        <DialogueBox line={current} selected={selected} onSelect={setSelected} print={print} saved={saved} />
        {current && (
          <p className="translation" lang="en">
            {current.translation?.text ?? (status?.translator ? "Translating…" : "No translation for this line.")}
          </p>
        )}
        {current && current.seenBefore > 0 && (
          <p className="seen">
            {current.seenBefore === 1 ? "You've seen this line once before." : `You've seen this line ${current.seenBefore} times before.`}
          </p>
        )}
        {current?.analysis && (
          <Breakdown
            lineId={current.id}
            tokens={current.analysis.tokens}
            selected={selected}
            onSelect={setSelected}
            saved={saved}
          />
        )}
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
