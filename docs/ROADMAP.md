# Roadmap

## Phase 1: Game adapter + ingest ✅ (current)
- mGBA Lua adapter: detects game by ROM game code, watches text buffers, decodes Gen 3 charset (incl. ä ö ü ß), sends NDJSON over TCP with reconnect + offline queue.
- RAM search helper (`tools/find_text.lua`) to locate buffers in the German ROM.
- Shared protocol types + validator (`packages/shared`).
- Node server that receives lines and prints them.
- Confirmed in German Smaragd (BPED): field buffer `0x02021FC4` and battle buffer `0x02022E2C` (same as US), and the „ “ quote glyphs.

## Phase 2: Language pipeline (server)
- Tokenizer for German (punctuation, compounds with hyphen, `POKéMON` and other all-caps game names, `{PLAYER}` placeholders).
- Dictionary lookup: lemma (dictionary form), part of speech, gender (der/die/das) and English gloss. A local Wiktionary extract (e.g. a Kaikki.org German dump) is imported into SQLite.
- A translation provider interface (`translate(text, from, to)`) with a pluggable backend (DeepL / LLM / offline), cached by line hash.
- SQLite (better-sqlite3): `lines`, `tokens`, `lexemes`, `translations` tables plus migrations.
- A game glossary for Pokémon names, items and moves, so they aren't "translated".

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

## Phase 6: More adapters
- Other Gen 3 games (Rubin/Saphir, Feuerrot/Blattgrün) as additional `games/*.lua` modules.
- A generic OCR adapter (screen region → text) for games without a RAM adapter.
- Other emulators or consoles behind the same protocol.
