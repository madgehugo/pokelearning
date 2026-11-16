# Language pipeline (server)

```
adapter line ─▶ ingest/tcp.ts ─▶ pipeline.ts ─┬─ db/app-db.ts          store the line
                                              ├─ language/analyze.ts   word-by-word breakdown
                                              │    ├─ tokenize.ts
                                              │    ├─ dictionary/db.ts (data/dictionary.db)
                                              │    └─ glossary.ts      (glossary/pokemon-de.json)
                                              └─ translate/translator.ts
                                                   ├─ prepare.ts       game text → MT-friendly text, sentences
                                                   ├─ app-db cache     one row per translated sentence
                                                   └─ provider.ts      ← opus-mt.ts (local)
                                         ─▶ "line" event (ProcessedLine) ─▶ print.ts (later: WebSocket)
```

Lines are processed one at a time, in arrival order. A failed translation is
logged, and the line is still stored and analysed.

## Dictionary

`npm run dict:import` streams the Kaikki.org German extract into
`data/dictionary.db`:

- `lexemes`: lemma, part of speech, gender (`m`/`f`/`n`/`pl`, or combinations), plural, up to 8 glosses with usage labels, and the separable prefix for verbs.
- `forms`: every inflected form, mapped to its lexeme with a grammatical description ("dative plural"). Two kinds of rows carry extra fields:
  - Split separable forms (*ruhe … aus*) store the particle they need.
  - Rows from a word's own "form of" entry (*dich*: accusative of du) are marked `direct`.

Rebuild it whenever you like. It doesn't contain any of your own data.

## Ranking readings

German words are ambiguous: *die* can be an article or a pronoun, *ruhe* can come from ruhen or ausruhen, and *Ich* can be the pronoun or the noun "ego". `analyze.ts` scores each reading:

| Signal | Effect |
| --- | --- |
| Spelling matches exactly. At a sentence start, either case counts. Gen 3 capitals count as a match. | + |
| Lowercase word read as a noun | −− (German nouns are capitalised) |
| Capitalised mid-sentence | + noun, − others |
| The word is a headword itself (*Leute*), not only an inflection | + |
| The word's own entry names the lexeme (`direct`) | + |
| Archaic or obsolete form or lexeme | − |
| Part of speech (article > pronoun/preposition > …) and number of senses | small tie-breakers |
| Separable reading whose particle appears later in the clause | ++, without the particle −− |

Glossary entries always win, and the dictionary readings become alternatives.
Up to three alternatives are kept for the UI.

## Translation

`prepare.ts` rewrites Gen 3 capitals ("POKéMON" → "Pokémon"; acronyms of up to
three letters like KP stay) and swaps glossary names (`mt` field: "BIRK" →
"Birch"). It then splits the line into sentences, because Opus-MT tends to drop
short sentences when given several at once. Each sentence is cached by
provider + language pair + text, so a repeated line is free.

To add a provider (DeepL, an LLM, …), implement `TranslationProvider` and
select it in `index.ts` via `TRANSLATOR`. Give it its own `id` so its cache
entries stay separate.

## Data files

| File | Contents | Safe to delete? |
| --- | --- | --- |
| `data/kaikki-german.jsonl.gz` | Downloaded Wiktionary extract | yes (re-downloaded by `dict:import`) |
| `data/dictionary.db` | Built dictionary | yes (`npm run dict:import`) |
| `data/models/` | Translation model | yes (re-downloaded on start) |
| `data/app.db` | **Your history**, later your word bank | no |
