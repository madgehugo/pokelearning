import { useEffect, useRef } from "react";
import type { TokenAnalysis, WordSense } from "@pokelearning/shared";
import { describeForm, FORM_MATTERS, genderKey, headword, posLabel, shortGloss, wordsOf } from "../words.ts";

interface Props {
  tokens: TokenAnalysis[];
  selected: number | null;
  onSelect(index: number | null): void;
}

export function Breakdown({ tokens, selected, onSelect }: Props) {
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
                aria-expanded={isSelected}
                onClick={() => onSelect(isSelected ? null : index)}
              >
                <span className="word-row__form" lang="de">
                  {token.text}
                </span>
                <Summary token={token} />
              </button>
              {isSelected && <Details token={token} tokens={tokens} />}
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

function Details({ token, tokens }: { token: TokenAnalysis; tokens: TokenAnalysis[] }) {
  const sense = token.best;
  const linked = token.linkedTo !== undefined ? tokens[token.linkedTo] : undefined;
  return (
    <div className="details">
      {sense && <SenseDetails sense={sense} />}
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
      {sense?.source === "glossary" && <p className="note">From the game glossary.</p>}
      {token.parts && (
        <div className="parts">
          {token.parts.map((p, i) => (
            <div key={i} className="part">
              <span className="word-row__form" lang="de">
                {p.text}
              </span>
              {p.best ? <SenseDetails sense={p.best} compact /> : <p className="muted">not in the dictionary</p>}
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
                <span className="pos">{posLabel(alt.pos)}</span> {shortGloss(alt.glosses[0])}
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
