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
| Only a subjunctive form (*führt* as a form of *fahren*) | − (loses to *führen*'s present tense) |
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
written in. The translator chooses *a* or *an* for "X1", so that is corrected
for the real name ("an X1" → "a Super Potion").

Placeholders are numbered per sentence, and each sentence is cached by
provider + language pair + text. So "X1 setzt X2 ein!" is translated once for
every Pokémon and move, and a repeated line is free. Sentences are translated
one at a time, because Opus-MT tends to drop short sentences when given
several at once.

## Game names

`npm run names:import` downloads PokéAPI's tables and writes
`data/pokemon-names.json`. The server turns the names for the game into
glossary entries. Emerald is generation 3 and Hoenn; set `NAMES_GENERATION` and
`NAMES_REGIONS` for another game.

| Kind | Example | Shown with |
| --- | --- | --- |
| Pokémon | ZIGZACHS → Zigzagoon | Pokédex number, category (*Kleindachs-Pokémon*, Tiny Raccoon Pokémon) |
| Move | GLUT → Ember | type, in English and German (*Typ Feuer*) |
| Ability | GROSSBRAND → Blaze | |
| Item | SUPERTRANK → Super Potion | category, the English Emerald bag description, gender (*der*) |
| Place | BLÜTENBURG CITY → Petalburg City | region |

How they are matched:

- **Capitals only.** Gen 3 writes names in capitals, so *GLUT* is the move,
  while *Glut* in normal text keeps its dictionary meaning (embers) with the
  move as an alternative. A name in normal case that the dictionary doesn't
  know (*Zigzachs*) still uses the name.
- **Multi-word names** ("BLÜTENBURG CITY", "RECHTE HAND", "ROUTE 101") are
  matched as one. The first word carries the reading (`phraseEnd`), and the
  others point to it (`partOf`). The UI shows them as one word.
- **ß = SS**, because capitals write *GROSSBRAND* for *Großbrand*.
- **Item plurals**: *POKéBÄLLE* is a compound whose last part is a plural the
  dictionary knows (*Bälle* → Ball), so it is the item Pokéball.
- **Item genders**: PokéAPI has none, so an item takes the gender of the same
  noun in the dictionary (*Trank*: der) or of its last part, which decides a
  German compound's gender (*Supertrank* → *Trank*, *Pokéball* → *Ball*). That
  gives items article cards in the word bank.

Entries in `glossary/pokemon-de.json` override imported names. After an import
or a dictionary rebuild, `npm run reprocess` re-analyses and re-translates
stored lines; unchanged sentences come from the cache.

## Data files

| File | Contents | Safe to delete? |
| --- | --- | --- |
| `data/kaikki-german.jsonl.gz` | Downloaded Wiktionary extract | yes (re-downloaded by `dict:import`) |
| `data/dictionary.db` | Built dictionary | yes (`npm run dict:import`) |
| `data/models/` | Translation model | yes (re-downloaded on start) |
| `data/pokemon-names.json` | Pokémon, move, ability, item and place names | yes (`npm run names:import`) |
| `data/app.db` | **Your history, word bank and review history** | no: back it up |
