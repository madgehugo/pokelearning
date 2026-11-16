import { Fragment, type CSSProperties, type ReactNode } from "react";
import { hiddenKeyOf, menuRows, wordKey, type ProcessedLine } from "@pokelearning/shared";
import { genderKey } from "../words.ts";

interface Props {
  line: ProcessedLine | undefined;
  selected: number | null;
  onSelect(index: number | null): void;
  /** Animate the text printing in (only for lines that just arrived). */
  print: boolean;
  /** wordKey()s of saved words, marked in the text. */
  saved: Set<string>;
  /** wordKey()s of hidden words: shown as plain text. */
  hidden: Set<string>;
}

/** Total time for a line to print in, like the game's text, whatever its length. */
const PRINT_MS = 700;

export function DialogueBox({ line, selected, onSelect, print, saved, hidden }: Props) {
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

  const pieces: { at: number; node: ReactNode }[] = [];
  const add = (at: number, node: ReactNode) => pieces.push({ at, node });
  const tokens = line.analysis?.tokens;
  if (!tokens) {
    add(0, line.text);
  } else {
    let cursor = 0;
    tokens.forEach((t, i) => {
      if (t.start > cursor) add(cursor, line.text.slice(cursor, t.start));
      cursor = t.end;
      if (t.kind !== "word" || hidden.has(hiddenKeyOf(t) ?? "")) {
        add(
          t.start,
          <span key={i} className="piece" style={delay(t.start)}>
            {t.text}
          </span>,
        );
        return;
      }
      if (t.partOf !== undefined) {
        // a later word of a multi-word name: opens the whole name
        const head = tokens[t.partOf]!;
        add(
          t.start,
          <button
            key={i}
            type="button"
            className="piece word"
            data-gender={genderKey(head.best)}
            aria-pressed={selected === t.partOf}
            style={delay(t.start)}
            onClick={() => onSelect(selected === t.partOf ? null : t.partOf!)}
          >
            {t.text}
          </button>,
        );
        return;
      }
      const known = !!t.best || !!t.parts?.some((p) => p.best);
      add(
        t.start,
        <button
          key={i}
          type="button"
          className="piece word"
          data-gender={genderKey(t.best)}
          data-unknown={known ? undefined : ""}
          data-saved={t.best && saved.has(wordKey(t.best.lemma, t.best.pos)) ? "" : undefined}
          aria-pressed={selected === i}
          style={delay(t.start)}
          onClick={() => onSelect(selected === i ? null : i)}
        >
          {t.text}
        </button>,
      );
    });
    if (cursor < line.text.length) add(cursor, line.text.slice(cursor));
  }

  // A menu screen: each label with its translation underneath.
  const rows = menuRows(line);
  if (rows) {
    return (
      <section className="box" aria-label="Current menu" aria-live="polite">
        <ul className="menu line" lang={line.lang ?? "de"} data-print={print ? "" : undefined} key={line.id}>
          {rows.map((row, i) => (
            <li key={i} className="menu__row">
              <span className="menu__label">
                {pieces.filter((p) => p.at >= row.start && p.at < row.end).map((p, j) => <Fragment key={j}>{p.node}</Fragment>)}
              </span>
              <span className="menu__translation" lang="en">{row.translation}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="box" aria-label="Current line" aria-live="polite">
      <p className="line" lang={line.lang ?? "de"} data-print={print ? "" : undefined} key={line.id}>
        {pieces.map((p, i) => <Fragment key={i}>{p.node}</Fragment>)}
      </p>
    </section>
  );
}
