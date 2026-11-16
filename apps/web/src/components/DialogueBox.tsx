import type { CSSProperties, ReactNode } from "react";
import type { ProcessedLine } from "@pokelearning/shared";
import { genderKey } from "../words.ts";

interface Props {
  line: ProcessedLine | undefined;
  selected: number | null;
  onSelect(index: number | null): void;
  /** Animate the text printing in (only for lines that just arrived). */
  print: boolean;
}

/** Total time for a line to print in, like the game's text, whatever its length. */
const PRINT_MS = 700;

export function DialogueBox({ line, selected, onSelect, print }: Props) {
  if (!line) {
    return (
      <section className="box box--empty" aria-label="Current line">
        <p className="line">Talk to someone in the game.</p>
        <p className="box__hint">Their words appear here, one line at a time.</p>
      </section>
    );
  }

  const msPerChar = Math.min(16, PRINT_MS / Math.max(line.text.length, 1));
  const delay = (offset: number) => ({ "--delay": `${Math.round(offset * msPerChar)}ms` }) as CSSProperties;

  const pieces: ReactNode[] = [];
  const tokens = line.analysis?.tokens;
  if (!tokens) {
    pieces.push(line.text);
  } else {
    let cursor = 0;
    tokens.forEach((t, i) => {
      if (t.start > cursor) pieces.push(line.text.slice(cursor, t.start));
      cursor = t.end;
      if (t.kind !== "word") {
        pieces.push(
          <span key={i} className="piece" style={delay(t.start)}>
            {t.text}
          </span>,
        );
        return;
      }
      const known = !!t.best || !!t.parts?.some((p) => p.best);
      pieces.push(
        <button
          key={i}
          type="button"
          className="piece word"
          data-gender={genderKey(t.best)}
          data-unknown={known ? undefined : ""}
          aria-pressed={selected === i}
          style={delay(t.start)}
          onClick={() => onSelect(selected === i ? null : i)}
        >
          {t.text}
        </button>,
      );
    });
    if (cursor < line.text.length) pieces.push(line.text.slice(cursor));
  }

  return (
    <section className="box" aria-label="Current line" aria-live="polite">
      <p className="line" lang={line.lang ?? "de"} data-print={print ? "" : undefined} key={line.id}>
        {pieces}
      </p>
    </section>
  );
}
