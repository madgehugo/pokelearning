# Roadmap

## Phase 1: Game adapter + ingest ✅
- mGBA Lua adapter: detects game by ROM game code, watches text buffers, decodes Gen 3 charset (incl. ä ö ü ß), sends NDJSON over TCP with reconnect + offline queue.
- RAM search helper (`tools/find_text.lua`) to locate buffers in the German ROM.
- Shared protocol types + validator (`packages/shared`).
- Node server that receives lines and prints them.
- Confirmed in German Smaragd (BPED): field buffer `0x02021FC4` and battle buffer `0x02022E2C` (same as US), and the „ “ quote glyphs.

## Phase 2: Language pipeline (server) ✅
- SQLite via the built-in `node:sqlite`: `data/dictionary.db` (rebuildable) and `data/app.db` (your data: lines, analyses, translation cache), with migrations.
- Dictionary built from the Kaikki.org extract of English Wiktionary: ~94k lexemes and ~1M inflected forms, each with its lemma, gender, plural and glosses (`npm run dict:import`).
- Analyzer: a tokenizer that understands Gen 3 capitals, compounds and placeholders. Readings are ranked by case and context, and separable verbs are linked to their particle (*Ruh dich aus* → ausruhen).
- A game glossary (`apps/server/src/language/glossary/pokemon-de.json`) for terms the dictionary doesn't know or gets wrong.
- Translation through a provider interface. The default is local Opus-MT (free, offline after the first download), translating one sentence at a time with each sentence cached.
- Unit tests (`npm test`).

### Follow-ups
- ✅ Pokémon and move names (German ↔ English) from PokéAPI (`npm run names:import`). Names written in Gen 3 capitals reach the translator as placeholders (X1, X2) and go back in as English afterwards.
- ✅ Abilities, items (with category and Emerald bag description) and Hoenn places from PokéAPI. Multi-word names ("BLÜTENBURG CITY", "RECHTE HAND") are matched as one, ß matches SS, and items are recognised in the plural (*POKéBÄLLE*). Items take their gender from the dictionary or from their compound's last part, so they get article cards.
- NPC and trainer names (*MR. BRIGGS*) aren't in PokéAPI; add the ones you meet to `glossary/pokemon-de.json`.
- Gen 3 sometimes shortened German names that later games spell in full. If one doesn't match, add it to `glossary/pokemon-de.json`, which overrides imported names.
- Split German compounds that have no hyphen and no dictionary entry (e.g. *Pokémonzentrum*).
- Use syntax to rank function words. For example, the relative pronoun *das* after a comma is currently read as an article; the correct reading is listed as an alternative.
- An optional DeepL or LLM translation provider behind the same interface.

## Phase 3: Web UI ✅
- React + TypeScript + Vite in `apps/web`. The server serves the built app on port 8766, with history at `GET /api/lines` and live lines over a WebSocket at `/ws` (a snapshot on connect, then one message per line).
- The current line appears in a dialogue box and prints in like game text. Every word is tappable, with nouns underlined in their gender colour (der blue, die rose, das green).
- The word breakdown shows the dictionary form, article, part of speech and meaning. An open word adds its grammar in plain words, all its meanings, separable-verb notes, compound parts and alternative readings. ← and → move between words.
- History of earlier lines (tap one to read it again; "Show the latest line" returns to live), with older lines loaded on request.
- Responsive from phone to desktop, light and dark themes, fonts bundled for offline use, a manifest for adding it to the home screen. `UI_HOST=0.0.0.0` opens it on the LAN.

### Follow-ups
- Offline support with a service worker. That needs HTTPS on the LAN (e.g. a local certificate); until then, the home-screen version needs the server running.
- A setting to turn off the print-in effect, and a font size control.

## Phase 4: Word bank + spaced repetition ✅
- Save any reading of a word (best reading, an alternative, or a compound part) from the live view or from history. Saved words get an amber dot in the dialogue box.
- Each word keeps up to five example sentences from the game and counts its encounters, including lines from before it was saved.
- FSRS-6 scheduling (`ts-fsrs`, 90% target retention). Cards:
  - *meaning* (German → English) for every word
  - *article* (der/die/das) for nouns with one gender
  - *recall* (English → German), optional
- New cards per day are capped (default 20), with one new card per word per day, so a noun's article card comes the day after its meaning card. Learning cards due within 20 minutes are shown early when nothing else is due.
- Review screen with interval previews and keyboard shortcuts. Words screen with search, example sentences, encounters, next review and removal. Review settings.
- Stats as a sentence: words, cards due now, retention over 30 days.
- Writes to the API must be same-origin JSON, because the UI may be open on the LAN.

### Follow-ups
- Undo the last answer.
- Optimise the FSRS parameters on your own review history once there are a few hundred reviews (FSRS optimizer).
- Count in-game encounters of saved words as light practice (FSRS doesn't model passive exposure, so this needs a separate rule).
- Collapse repeated lines (the same battle message several times) in the history.

## Phase 5: Mini-games ✅
Built from your own material: saved words first, then the words and lines you played (the last 1,500 lines).

- **Article sprint**: 60 seconds of der/die/das. Mistakes are listed afterwards with the plural.
- **Fill the gap**: a line with one content word blanked, preferring saved words. The other three options are words of the same part of speech from your lines. The translation is available as a hint.
- **Listening**: the browser's German voice (Web Speech API) reads a line, and you pick its translation from four lines you played. You can replay it, or hear it slower.
- **Matching**: six German words and their meanings. Time counts, with 3 s added per wrong pair.
- Words seen only in Gen 3 capitals (menu and battle words like *ZURÜCK*, *NORMAL*) are left out of the noun games, because capitalised they look like nouns.
- Results and bests are stored in `game_results`. They don't change FSRS scheduling.

### Follow-ups
- A typing mode (spell the word), with umlaut buttons for phones.
- Listening in "dictation" mode: type what you hear.
- Pick game words only from a chosen part of the game, or only saved words.
- Optionally, count a game answer as light FSRS practice.

## Adapter gaps (from phase 1) ✅ (tested against a simulated printer; confirm in-game)
- **The same message twice in a row**: the adapter finds the game's text printer cursor by itself (a RAM pointer that moves through the buffer while a message prints) and sends the message again whenever that cursor jumps back into the buffer. The server counts how often each line came up.
- **Text printed straight from ROM** (item descriptions, Pokédex entries…): "cursor sources" in `games/emerald.lua` follow a printer's pointer into ROM and send the whole string once it has stayed on screen for about 0.5 s. Each one needs its address found once with `find(…, true)`, `findPointer` and `watchCursor` (docs/finding-addresses.md).
- Still not covered: screens that draw text without a text printer (e.g. the naming screen). That would need the OCR adapter.

## Phase 6: More adapters
- Other Gen 3 games (Rubin/Saphir, Feuerrot/Blattgrün) as additional `games/*.lua` modules.
- A generic OCR adapter (screen region → text) for games without a RAM adapter.
- Other emulators or consoles behind the same protocol.
