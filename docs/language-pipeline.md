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
                                         ─▶ "line" event (ProcessedLine) ─▶ print.ts (terminal)
                                                                         └▶ ui/server.ts (WebSocket /ws, GET /api/lines)
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
| Separable reading whose particle is the last word of the clause | ++, otherwise −− (mid-clause *auf dich* is a preposition) |

Glossary entries always win, and the dictionary readings become alternatives.
Up to three alternatives are kept for the UI.

## Translation

`prepare.ts` rewrites Gen 3 capitals ("POKéMON" → "Pokémon"; acronyms of up to
three letters like KP stay). It then replaces glossary terms that have an
English form (`mt` field: Pokémon, moves, "BIRK" → "Birch", "E.-Punkte") with
numbered placeholders, and splits the line into sentences:

```
FLEMMLI setzt GLUT ein!   →   "X1 setzt X2 ein!"  slots: Torchic, Ember
                          →   "X1 uses X2!"       (Opus-MT)
                          →   "Torchic uses Ember!"
```

Opus-MT garbles English names inside German text ("Scratch" → "SStitch",
"Tackle" → "Ta-Nearly"), but copies X1, X2 unchanged. In a comparison on real
battle lines, all placeholders survived, and the translations read better than
with real first names or [1]-style brackets as placeholders. If a placeholder
ever goes missing, that sentence is translated again with the English names
written in.

Placeholders are numbered per sentence, and each sentence is cached by
provider + language pair + text. So "X1 setzt X2 ein!" is translated once for
every Pokémon and move, and a repeated line is free. Sentences are translated
one at a time, because Opus-MT tends to drop short sentences when given
several at once.

## Pokémon and move names

`npm run names:import` downloads PokéAPI's species, move and type tables and
writes `data/pokemon-names.json`. The server turns every species and move up
to `NAMES_MAX_GENERATION` (default 3, for Emerald) into a glossary entry with:

- the English name and translator form,
- the Pokédex number and category (*Kleindachs-Pokémon*, Tiny Raccoon Pokémon) for species,
- the type, in English and German (*Typ Feuer*), for moves.

These entries are `capsOnly`: Gen 3 writes names in capitals, so *GLUT* is the
move Ember, while *Glut* in normal text keeps its dictionary meaning (embers)
with the move offered as an alternative. A name in normal case that the
dictionary doesn't know (*Zigzachs*) still uses the name. Entries in
`glossary/pokemon-de.json` override imported names.

`npm run reprocess` re-analyses and re-translates stored lines after a names
import or dictionary rebuild. Unchanged sentences come from the cache.

To add a provider (DeepL, an LLM, …), implement `TranslationProvider` and
select it in `index.ts` via `TRANSLATOR`. Give it its own `id` so its cache
entries stay separate.

## Data files

| File | Contents | Safe to delete? |
| --- | --- | --- |
| `data/kaikki-german.jsonl.gz` | Downloaded Wiktionary extract | yes (re-downloaded by `dict:import`) |
| `data/dictionary.db` | Built dictionary | yes (`npm run dict:import`) |
| `data/models/` | Translation model | yes (re-downloaded on start) |
| `data/pokemon-names.json` | Pokémon and move names | yes (`npm run names:import`) |
| `data/app.db` | **Your history, word bank and review history** | no: back it up |
