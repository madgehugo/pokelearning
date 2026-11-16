import { useEffect, useRef, useState } from "react";
import { wordKey, type SaveWordRequest, type TokenAnalysis, type WordSense } from "@pokelearning/shared";
import { api } from "../api.ts";
import {
  describeForm,
  FORM_MATTERS,
  GAME_NAME_POS,
  genderKey,
  headword,
  posLabel,
  shortGloss,
  wordsOf,
  wordText,
} from "../words.ts";

interface Props {
  lineId: number;
  tokens: TokenAnalysis[];
  selected: number | null;
  onSelect(index: number | null): void;
  /** wordKey()s of saved words. */
  saved: Set<string>;
}

export function Breakdown({ lineId, tokens, selected, onSelect, saved }: Props) {
  const words = wordsOf(tokens);
  const selectedRow = useRef<HTMLLIElement>(null);

  useEffect(() => {
    selectedRow.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  if (words.length === 0) return null;
  return (
    <section className="breakdown" aria-label="Words in this line">
      <ul className="words">
        {words.map(({ index, token }) => {
          const isSelected = selected === index;
          return (
            <li key={index} ref={isSelected ? selectedRow : undefined} data-selected={isSelected ? "" : undefined}>
              <button
                type="button"
                className="word-row"
                data-saved={token.best && saved.has(wordKey(token.best.lemma, token.best.pos)) ? "" : undefined}
                aria-expanded={isSelected}
                onClick={() => onSelect(isSelected ? null : index)}
              >
                <span className="word-row__form" lang="de">
                  {wordText(tokens, index)}
                </span>
                <Summary token={token} />
              </button>
              {isSelected && <Details token={token} tokens={tokens} lineId={lineId} index={index} saved={saved} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Summary({ token }: { token: TokenAnalysis }) {
  const sense = token.best;
  if (!sense) {
    return (
      <span className="word-row__summary word-row__summary--unknown">
        {token.parts ? `compound: ${token.parts.map((p) => p.text).join(" + ")}` : "not in the dictionary"}
      </span>
    );
  }
  return (
    <span className="word-row__summary">
      <span className="headword" lang="de" data-gender={genderKey(sense)}>
        {headword(sense)}
      </span>{" "}
      <span className="pos">{posLabel(sense.pos)}</span>{" "}
      <span className="gloss">{shortGloss(sense.glosses[0])}</span>
      {FORM_MATTERS.has(sense.pos) && sense.formTags && (
        <span className="form-hint">, {describeForm(sense.formTags)}</span>
      )}
    </span>
  );
}

interface DetailsProps {
  token: TokenAnalysis;
  tokens: TokenAnalysis[];
  lineId: number;
  index: number;
  saved: Set<string>;
}

function Details({ token, tokens, lineId, index, saved }: DetailsProps) {
  const sense = token.best;
  const linked = token.linkedTo !== undefined ? tokens[token.linkedTo] : undefined;
  return (
    <div className="details">
      {sense && <SenseDetails sense={sense} />}
      {sense && <SaveButton sense={sense} saved={saved} request={{ lineId, tokenIndex: index }} />}
      {sense?.particle && linked && sense.formTags !== "separated prefix" && (
        <p className="note">
          Separable verb: <i lang="de">{linked.text}</i> at the end of the clause belongs to it, giving{" "}
          <b lang="de">{sense.lemma}</b>.
        </p>
      )}
      {sense?.formTags === "separated prefix" && linked && (
        <p className="note">
          The prefix of <b lang="de">{sense.lemma}</b>, split off from <i lang="de">{linked.text}</i>. German moves it
          to the end of the clause.
        </p>
      )}
      {sense?.source === "glossary" && (
        <p className="note">
          {GAME_NAME_POS.has(sense.pos)
            ? "German and English names from PokéAPI."
            : "From the game glossary."}
        </p>
      )}
      {token.parts && (
        <div className="parts">
          {token.parts.map((p, i) => (
            <div key={i} className="part">
              <span className="word-row__form" lang="de">
                {p.text}
              </span>
              {p.best ? (
                <>
                  <SenseDetails sense={p.best} compact />
                  <SaveButton sense={p.best} saved={saved} request={{ lineId, tokenIndex: index, part: i }} small />
                </>
              ) : (
                <p className="muted">not in the dictionary</p>
              )}
            </div>
          ))}
        </div>
      )}
      {token.alternatives && token.alternatives.length > 0 && (
        <div className="alternatives">
          <p className="muted">Could also be</p>
          <ul>
            {token.alternatives.map((alt, i) => (
              <li key={i}>
                <span className="headword" lang="de" data-gender={genderKey(alt)}>
                  {headword(alt)}
                </span>{" "}
                <span className="pos">{posLabel(alt.pos)}</span> {shortGloss(alt.glosses[0])}{" "}
                <SaveButton sense={alt} saved={saved} request={{ lineId, tokenIndex: index, alternative: i }} small />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SenseDetails({ sense, compact = false }: { sense: WordSense; compact?: boolean }) {
  const form = describeForm(sense.formTags);
  const glosses = compact ? sense.glosses.slice(0, 2) : sense.glosses;
  // The row above already shows the first meaning; repeat it only as part of a list
  // or when it was shortened there.
  const showGlosses = compact || glosses.length > 1 || shortGloss(glosses[0]) !== glosses[0];
  return (
    <>
      {compact && (
        <p>
          <span className="headword" lang="de" data-gender={genderKey(sense)}>
            {headword(sense)}
          </span>{" "}
          <span className="pos">{posLabel(sense.pos)}</span>
        </p>
      )}
      {(form || sense.plural) && (
        <p className="grammar">
          {form && form !== "separated prefix" && <>Here: {form}. </>}
          {sense.plural && (
            <>
              Plural: <span lang="de">die {sense.plural}</span>.
            </>
          )}
        </p>
      )}
      {showGlosses &&
        (glosses.length > 1 ? (
          <ol className="glosses">
            {glosses.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ol>
        ) : (
          <p className="glosses">{glosses[0]}</p>
        ))}
    </>
  );
}

interface SaveButtonProps {
  sense: WordSense;
  saved: Set<string>;
  request: SaveWordRequest;
  /** Inline text button, for alternatives and compound parts. */
  small?: boolean;
}

function SaveButton({ sense, saved, request, small = false }: SaveButtonProps) {
  const [state, setState] = useState<"idle" | "saving" | { error: string }>("idle");
  if (saved.has(wordKey(sense.lemma, sense.pos))) {
    return <span className={small ? "saved-note saved-note--small" : "saved-note"}>In your word bank</span>;
  }
  const save = async () => {
    setState("saving");
    try {
      await api.saveWord(request);
      setState("idle"); // the word bank update from the server marks it saved
    } catch (err) {
      setState({ error: (err as Error).message });
    }
  };
  return (
    <>
      <button
        type="button"
        className={small ? "link-button" : "save-button"}
        disabled={state === "saving"}
        onClick={() => void save()}
      >
        {small ? "Save this reading" : "Save word"}
      </button>
      {typeof state === "object" && <span className="error"> Couldn't save: {state.error}</span>}
    </>
  );
}
