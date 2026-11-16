import type { ProcessedLine } from "@pokelearning/shared";

interface Props {
  lines: ProcessedLine[];
  currentId: number | undefined;
  hasOlder: boolean;
  onPick(id: number): void;
  onLoadOlder(): void;
}

const SOURCES: Record<string, string> = { battle: "Battle", bag: "Bag" };

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function History({ lines, currentId, hasOlder, onPick, onLoadOlder }: Props) {
  if (lines.length === 0) return null;
  return (
    <section className="history" aria-labelledby="history-title">
      <h2 id="history-title">Earlier lines</h2>
      <ol className="history__list">
        {lines.map((l) => (
          <li key={l.id}>
            <button
              type="button"
              className="history__item"
              aria-current={l.id === currentId ? "true" : undefined}
              onClick={() => onPick(l.id)}
            >
              <span className="history__text" lang={l.lang ?? "de"}>
                {l.text}
              </span>
              {l.translation && <span className="history__translation">{l.translation.text}</span>}
              <span className="history__meta">
                <time dateTime={new Date(l.receivedAt).toISOString()}>{clock(l.receivedAt)}</time>
                {l.source && SOURCES[l.source] && <span className="history__source">{SOURCES[l.source]}</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {hasOlder && lines.length >= 30 && (
        <button type="button" className="quiet-button" onClick={onLoadOlder}>
          Show older lines
        </button>
      )}
    </section>
  );
}
