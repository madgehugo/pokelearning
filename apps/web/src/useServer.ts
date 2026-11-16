/** Live connection to the server: lines (newest first), status, history paging. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProcessedLine, ServerMessage, ServerStatus } from "@pokelearning/shared";

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
        } else if (msg.type === "line") {
          setLines((prev) => merge([msg.line], prev));
        } else if (msg.type === "status") {
          setStatus(msg.status);
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

  return { lines, status, connection, hasOlder, loadOlder };
}
