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

### Spanish (in progress)
- **Done:** per-language dictionary, analysis (el/la, no German-only rules), names, `es→en` translation, on-demand download, tests with real data.
- **Also done:** a language on saved and hidden words (migration 6), el/la cards, per-language games with a language switch, the `es-ES` voice for Listening, Spanish stat labels (taken from the Esmeralda ROM).
- **Confirmed in-game (Esmeralda, Spain):** dialogue, battle text and menus, including the bag (its pocket names are drawn in pairs; only the one on screen is sent).
- **Ranking and labels:** after an article or possessive a noun beats an adjective or verb (*tu padre*); function words beat their rare noun readings (*no*, *contra*); a small hand-written Spanish glossary covers *tu, mi, veces, he, lo, sí*; the options and trainer-card labels and stat names get English names (stats are spelt out inside sentences so the translation reads right). Clitic forms (*dámelo*, *verlo*) already resolve through the dictionary.
- **Names as the ROM spells them:** the Esmeralda ROM's move and ability table is compared with PokéAPI, and the 51 spellings that differ (*DISP. DEMORA* = String Shot, *ELEC. ESTÁT.* = Static) are in `glossary/rom-es.json`. Glossary phrases may now contain full stops.
- **Also:** imperatives at the start of a sentence (*¡Ven!* = venir), *-ísimo* forms, Internet spellings ranked last, and a few idioms the translator got wrong are reworded before translating (*estupendo*, *ya que estamos*, *retoño*).
- **Next:** an adjective after its noun (*PARTIDA NUEVA*), and more idioms as they turn up in play. Item names the ROM shortens are not yet compared.

### Follow-ups
- ✅ Pokémon and move names (German ↔ English) from PokéAPI (`npm run names:import`). Names written in Gen 3 capitals reach the translator as placeholders (X1, X2) and go back in as English afterwards.
- ✅ Abilities, items (with category and Emerald bag description) and Hoenn places from PokéAPI. Multi-word names ("BLÜTENBURG CITY", "RECHTE HAND") are matched as one, ß matches SS, and items are recognised in the plural (*POKéBÄLLE*). Items take their gender from the dictionary or from their compound's last part, so they get article cards.
- NPC and trainer names (*MR. BRIGGS*) aren't in PokéAPI; add the ones you meet to `glossary/pokemon-de.json`.
- Gen 3 sometimes shortened German names that later games spell in full. If one doesn't match, add it to `glossary/pokemon-de.json`, which overrides imported names.
- Compounds with no hyphen and no entry are split into dictionary words (*Knopfbelegung* → Knopf + Belegung; a noun in -ung comes from its verb). Longer or irregular ones can still be missed.
- Syntax-aware ranking for function words is partial: der/die/das/den/dem after a comma and before a lowercase non-adjective (*das ich suche*) are read as relative pronouns. Other cases (a relative clause opening a sentence, *die* vs *sie*) still use the general ranking.
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

## Phase 6: More adapters ✅
- **All Gen 3 Pokémon games** in the mGBA adapter (`games/gen3.lua`): Ruby, Sapphire, FireRed, LeafGreen and Emerald, in German, English, French, Italian and Spanish, recognised by game code. Japanese uses another character set and isn't supported.
- **Text buffer discovery** (`lib/discover.lua`) for games without known addresses. Twice a second it checks which strings in EWRAM changed, and adopts a start address once three different sentence-like messages have appeared there. Stale tails of longer messages and blank memory before a buffer are filtered out. Tested on a simulated FireRed with field and battle buffers, not yet on a real ROM.
- **Per-game names**: each game id gets its generation's and region's names (FireRed: Kanto, Emerald: Hoenn). Lines in languages the translator can't handle are stored and shown without a translation.
- **OCR adapter for macOS** (`adapters/ocr-macos`): captures a window with ScreenCaptureKit, reads the text area with Apple Vision, and sends each finished text box. Works with any emulator or game. Tested on rendered GBA-style text boxes and end to end with a replayed session; live capture needs Screen Recording permission.

### Follow-ups
- Pin the addresses that discovery finds for Ruby, Sapphire, FireRed and LeafGreen in `games/` files, once found on real ROMs.
- An OCR adapter for Windows/Linux (e.g. Tesseract), or reading memory through RetroArch's network commands.
- Gen 4 (DS) games: a different character set and emulators (melonDS, DeSmuME); OCR works today.

## Playing with the companion ✅
- `npm run play`: builds the website, starts the server (or reuses a running one), opens mGBA with your remembered ROM, and opens the side panel. The script path goes to the clipboard for the one manual step.
- **Side panel** (`apps/panel-macos`): a native macOS window that stays on top, docks next to the mGBA window and follows it, and doesn't take keyboard focus from the game. It shows `#/panel`, a compact live view with saving; Review, Words and Games open on the website.
- [User guide](GUIDE.md) with setup, everyday use and troubleshooting.

### Follow-ups
- Load the script automatically once mGBA's scripting can do that (newer development builds have script autoloading).
- An "Open panel" button in the website for when the panel was closed.

## Pokélearning.app ✅
- **One app with mGBA built in** (`apps/desktop-macos`, `npm run package`). It contains a pinned mGBA development build with `--script`, so the companion script runs with no manual step, plus Node, the server, the website and the panel.
- **First launch:** asks for your own ROM (remembered), then downloads the dictionary, names and model with a progress page (`#/setup`, `/api/setup`). After that, opening the app starts the game with the companion running and docks the panel. Quitting mGBA quits the app.
- **Menus:** Go (Live, Review, Words, Games), Panel, File (Change ROM, Back Up / Restore Progress, data and logs), Phone (allow LAN access).
- **Distribution:** a DMG of about 130 MB (the app is about 360 MB), Apple Silicon, macOS 14+. Signed ad hoc, not notarized: recipients allow it once with Open Anyway.

### Follow-ups
- Sign with a Developer ID and notarize, so the app opens without the Open Anyway step.
- A universal build (Intel Macs).
- Updating itself: the app only tells you a newer release exists (a daily GitHub check, `UPDATE_CHECK=0` to disable); you download it yourself. It finds nothing until a release is published on GitHub.
- Move to the mGBA 0.11 release once it's out, instead of a development build.
