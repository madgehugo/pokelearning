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
- Import Pokémon, item and move names (German ↔ English) from PokéAPI's CSV data into the glossary, so a word like *ZIGZACHS* gets a reading.
- Split German compounds that have no hyphen and no dictionary entry (e.g. *Pokémonzentrum*).
- Use syntax to rank function words. For example, the relative pronoun *das* after a comma is currently read as an article; the correct reading is listed as an alternative.
- An optional DeepL or LLM translation provider behind the same interface.

## Phase 3: Web UI
- React + TypeScript + Vite in `apps/web`. The server adds a WebSocket and pushes `line`, `analysis` and `translation` events.
- Live view: the German line, its translation, and clickable word chips (lemma, article, meaning).
- History of recent lines. Responsive layout and installable PWA for use on a phone over the LAN.

## Phase 4: Word bank + spaced repetition
- Save words or phrases with the sentence they came from (game, line, timestamp).
- FSRS scheduling (`ts-fsrs`), with review sessions in the UI covering recognition, article (der/die/das) and production.
- Stats: words learned, retention, words due.

## Phase 5: Mini-games
- Article sprint (der/die/das), cloze from your own game lines, listening (TTS), matching.

## Adapter gaps (from phase 1) ✅ (tested against a simulated printer; confirm in-game)
- **The same message twice in a row**: the adapter finds the game's text printer cursor by itself (a RAM pointer that moves through the buffer while a message prints) and sends the message again, marked `repeated`, whenever that cursor jumps back into the buffer.
- **Text printed straight from ROM** (item descriptions, Pokédex entries…): "cursor sources" in `games/emerald.lua` follow a printer's pointer into ROM and send the whole string once it has stayed on screen for about 0.5 s. Each one needs its address found once with `find(…, true)`, `findPointer` and `watchCursor` (docs/finding-addresses.md).
- Still not covered: screens that draw text without a text printer (e.g. the naming screen). That would need the OCR adapter.

## Phase 6: More adapters
- Other Gen 3 games (Rubin/Saphir, Feuerrot/Blattgrün) as additional `games/*.lua` modules.
- A generic OCR adapter (screen region → text) for games without a RAM adapter.
- Other emulators or consoles behind the same protocol.
