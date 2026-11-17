/** Live connection to the server: lines (newest first), status, history paging. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProcessedLine, ServerMessage, ServerStatus, SetupStatus, WordBankSummary } from "@pokelearning/shared";

/** What setup is downloading right now, in a few words, or null. Shown while a new language is set up during play. */
export function setupNote(setup: SetupStatus | null): string | null {
  const step = setup?.steps.find((s) => s.state === "running");
  if (!setup || setup.ready || !step) return null;
  return `Getting ready: ${step.detail}${step.progress !== null ? ` ${Math.round(step.progress * 100)}%` : ""}`;
}

export type Connection = "connecting" | "open" | "offline";

const MAX_LINES = 500;

function merge(a: ProcessedLine[], b: ProcessedLine[]): ProcessedLine[] {
  const byId = new Map<number, ProcessedLine>();
  for (const l of [...b, ...a]) byId.set(l.id, l); // entries from `a` win
  return [...byId.values()].sort((x, y) => y.id - x.id).slice(0, MAX_LINES);
}

export function useServer() {
  const [lines, setLines] = useState<ProcessedLine[]>([]);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [hasOlder, setHasOlder] = useState(true);
  const [wordbank, setWordbank] = useState<WordBankSummary | null>(null);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const loadingOlder = useRef(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;
    let stopped = false;

    const connect = () => {
      setConnection("connecting");
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      ws.onopen = () => {
        setConnection("open");
        delay = 1000;
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string) as ServerMessage;
        if (msg.type === "snapshot") {
          setLines((prev) => merge(msg.lines, prev));
          setStatus(msg.status);
          setWordbank(msg.wordbank);
        } else if (msg.type === "line") {
          setLines((prev) => merge([msg.line], prev));
        } else if (msg.type === "status") {
          setStatus(msg.status);
        } else if (msg.type === "wordbank") {
          setWordbank(msg.wordbank);
        } else if (msg.type === "setup") {
          setSetup(msg.setup);
        }
      };
      ws.onclose = () => {
        setConnection("offline");
        if (stopped) return;
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 10_000);
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, []);

  const loadOlder = useCallback(async () => {
    const oldest = lines.at(-1);
    if (!oldest || loadingOlder.current) return;
    loadingOlder.current = true;
    try {
      const res = await fetch(`/api/lines?before=${oldest.id}&limit=50`);
      const older = (await res.json()) as ProcessedLine[];
      if (older.length < 50) setHasOlder(false);
      setLines((prev) => merge(prev, older));
    } finally {
      loadingOlder.current = false;
    }
  }, [lines]);

  // Cards fall due as time passes, without any event: refresh the counts now and then.
  useEffect(() => {
    if (connection !== "open") return;
    const timer = setInterval(async () => {
      const stats = await fetch("/api/stats").then((r) => r.json()).catch(() => null);
      if (stats) setWordbank((prev) => (prev ? { ...prev, stats } : prev));
    }, 60_000);
    return () => clearInterval(timer);
  }, [connection]);

  return { lines, status, connection, hasOlder, loadOlder, wordbank, setup };
}
