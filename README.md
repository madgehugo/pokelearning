# Pokélearning

A German-learning companion that runs next to a GBA emulator. When a dialogue
line appears in the game, the companion shows the German text, an English
translation and a word-by-word breakdown (dictionary form, der/die/das,
meaning). You can save words to a personal word bank and review them with
spaced repetition (FSRS). First target: **Pokémon Smaragd** (German Emerald) in
**mGBA 0.10+**.

> Bring your own ROM, dumped from your own cartridge. ROMs, saves and save
> states are git-ignored and must never be committed.

## Architecture

```
┌─ mGBA + Lua adapter ─────────┐      ┌─ server (Node/TS) ───────────────────┐      ┌─ panel and website ────────┐
│ dialogue: text buffers       │      │ tokenize → dictionary (Wiktionary)   │      │ side panel (Swift), docked │
│ menus: AddTextPrinter hook   │─────▶│ → translate (Opus-MT, on your Mac)   │─────▶│ next to mGBA (#/panel)     │
│ Gen 3 charset → UTF-8        │ TCP  │ → SQLite, word bank + FSRS           │ HTTP │ website: Live, Review,     │
└──────────────────────────────┘ 8765 │ mini-games                           │ 8766 │ Words, Games (phone too)   │
                                      └──────────────────────────────────────┘      └────────────────────────────┘
```

The OCR adapter (any game, macOS) sends the same messages as the Lua adapter.
`Pokélearning.app` starts all of it: the server, mGBA with the script, and the panel.

Adapters are plug-ins. Anything that can produce
`{ type: "line", adapter, game, line, timestamp }` can feed the server: another
game module, another emulator, or an OCR adapter. See
[docs/adapter-protocol.md](docs/adapter-protocol.md).

## Repo layout

| Path | What |
| --- | --- |
| `adapters/mgba-lua/` | mGBA Lua adapter for all Gen 3 Pokémon games: `main.lua` entry, `lib/` (charmap, JSON, transport, buffer discovery), `games/` (game registry, known addresses), `tools/find_text.lua` (RAM search) |
| `adapters/ocr-macos/` | Screen-reading adapter for any game window (Apple Vision), see its [README](adapters/ocr-macos/README.md) |
| `packages/shared/` | TypeScript types shared by adapters, server and UI: adapter protocol, line analysis |
| `apps/server/` | Node server: ingest → word-by-word analysis → translation → SQLite (see [docs/language-pipeline.md](docs/language-pipeline.md)) |
| `apps/web/` | Browser UI: React + Vite, responsive, live over WebSocket; `#/panel` is the compact side-panel view |
| `apps/panel-macos/` | Native side panel (Swift): docks next to mGBA and shows `#/panel` |
| `scripts/play.mjs` | `npm run play`: server, mGBA and panel in one command (from source) |
| `apps/desktop-macos/` | `Pokélearning.app`: starts the server, mGBA (with `--script`) and the panel; menus, setup, backups |
| `scripts/package-mac.mjs`, `packaging/` | `npm run package`: builds the app and the DMG |
| `docs/` | [User guide](docs/GUIDE.md), roadmap, protocol, address-finding guide, language pipeline |

## Quick start

**New here? Read the [user guide](docs/GUIDE.md):** installing, a typical
session, and troubleshooting.

### The app (easiest)

`Pokélearning.app` has everything built in, mGBA included. Open the DMG, drag
the app to Applications, and open it. The first time:
1. Allow it once in System Settings → Privacy & Security → **Open Anyway**.
2. Choose your own ROM.
3. Let it download its data (about 230 MB).

After that, opening the app starts your game with the companion running, and
docks the panel next to it. Apple Silicon Macs with macOS 14 or newer.

To build the app and its DMG yourself: `npm run package` → `dist/Pokélearning-<version>-arm64.dmg`.
The package script pins and checksums its downloads (`packaging/manifest.json`).

### From source

Requirements: Node 22.13+ (tested on 26; uses the built-in `node:sqlite`),
mGBA 0.10+ (tested on 0.10.5), and Xcode or the command line tools for the side
panel.

```sh
npm install
npm run dict:import                       # once: German dictionary (~100 MB download, ~15 s)
npm run names:import                      # once: Pokémon, move, item and place names
npm run play -- ~/Games/smaragd.gba       # first time; afterwards just `npm run play`
```

`npm run play` starts the server, opens mGBA with your ROM, and opens a side
panel that docks next to the mGBA window. The panel shows each German line, its
translation and its words, and lets you save words. Then load the Lua script in
mGBA (below; the path is on your clipboard). Review, your word bank and the
games are on the website at http://localhost:8766.

### What it does

Each line from the game shows up with its English translation, and every word
with its dictionary form, der/die/das (colour-coded: blue, rose, green) and
meaning. Tap a word for its grammar ("feminine singular, nominative or
accusative"), all its meanings, and the other readings it could have. ← and →
move between words.

**Word bank and review:** choose *Save word* in a word's details. The word keeps
the sentence it came from, and every later line that uses it counts as an
encounter and can add another example. **Review** asks you one card at a time,
scheduled with FSRS:
- *Meaning*: the German word with its sentence → what it means.
- *Article*: nouns only. Tap der, die or das.
- *Recall* (optional, under Words → Review settings): English → the German word.

Grade yourself with Again, Hard, Good or Easy; each button shows when the card
comes back. Keys: Space shows the answer, 1–4 grade, 1–3 pick an article.
**Words** lists your saved words with their example sentences, encounters and
next review.

**Games** are built from your own words and lines, saved words first:
- *Article sprint*: 60 seconds of der, die or das.
- *Fill the gap*: a line from your game with one word missing, four choices.
- *Listening*: the browser reads a line aloud in German (on a Mac, the built-in
  voice Anna), and you pick what it means. R replays, Shift+R slower.
- *Matching*: pair six German words with their meanings against the clock.

Results and personal bests are kept, but games don't change your review
schedule.

Game names get their English name:

- Pokémon: *ZIGZACHS* is Zigzagoon (No. 263, the *Kleindachs-Pokémon*).
- Moves: *GLUT* is the Fire-type move Ember.
- Abilities: *GROSSBRAND* is Blaze.
- Items: *der SUPERTRANK* is Super Potion, with its Emerald bag description.
- Places: *BLÜTENBURG CITY* is Petalburg City.

The translator sees them as English too, so "FLEMMLI setzt GLUT ein!" becomes
"Torchic uses Ember!". Gen 3 writes these names in capitals, which is how a
move like *GLUT* is told apart from the word *Glut* (embers) in normal text.
After importing names or rebuilding the dictionary, `npm run reprocess`
updates the lines you've already played.

Everything is local and free: no accounts or API keys. Downloaded data and your
database live in `data/` (git-ignored). Set `TRANSLATOR=none` to turn off
translation.

The only thing it asks the internet for after setup is whether a newer release
exists (GitHub's releases API, once a day; an "Update" link appears in the
top bar). Set `UPDATE_CHECK=0` to turn that off.

**On your phone:** start with `npm run play -- --lan` and open the address the
server prints (`http://192.168.…:8766`) on a phone on the same Wi-Fi. On iOS,
*Share → Add to Home Screen* gives it its own icon. Only the web UI is opened
to the network; the adapter port stays local.

Developing:

```sh
npm run dev               # server with reload + Vite dev server (http://localhost:5173)
npm run send-test         # fake game lines, no emulator needed
npm test                  # unit tests
npm run typecheck
```

### Loading the Lua script in mGBA

1. Start mGBA and load your Smaragd ROM.
2. Open **Tools → Scripting…**. This opens the scripting window, which has a console.
3. In that window choose **File → Load script…** and pick
   `adapters/mgba-lua/main.lua`.
4. The console should show something like
   `Pokémon Emerald detected (game code BPED, language de)` and, once the server
   is running, `connected to 127.0.0.1:8765`. If the server starts later, the
   script reconnects by itself.
5. Talk to someone. The line shows up in the browser, the server terminal and the mGBA console.

Changed a Lua file? Load `main.lua` again. The script removes its old callbacks first.
mGBA also keeps a **File → Recent scripts** list.

Commands you can type into the console's input line:
`pokelearning.status()` and `pokelearning.setBuffer("field", 0x0202xxxx)`.

### Other Gen 3 games

The adapter recognises Ruby, Sapphire, FireRed, LeafGreen and Emerald in
German, English, French, Italian and Spanish. Emerald's text buffer addresses
are known. For the other games, the adapter finds them while you play: after
about three messages, the console prints `found a text buffer at 0x…`, and lines
start coming in. FireRed and LeafGreen get Kanto's place names, the others
Hoenn's.

### Spanish games

Spanish games (Pokémon Esmeralda and the other Gen 3 titles) are read in Spanish
with English translations: a Spanish dictionary (Wiktionary), `es→en`
translation, and Spanish game names. When a Spanish game connects, the app
downloads what it needs (about 160 MB) and shows the progress in the top bar.
From source: `npm run dict:import -- es` and `npm run names:import`.
Saved words, review (el/la article cards) and the games work for Spanish too:
each word keeps its language, and the Games page has a German/Spanish switch.
The Listening game uses a Spain Spanish voice (`es-ES`). Only the Smaragd ROM
has been tested in-game; Esmeralda's menus and text buffers haven't.

### Games without a RAM adapter

The [OCR adapter](adapters/ocr-macos/README.md) reads a game window's text box
with Apple Vision and sends the text over the same protocol:
`npm run ocr:build`, then `npm run ocr -- --window mGBA --game pokemon-emerald-de`.

### If no lines appear: finding the German addresses

The buffer addresses come from the pokeemerald decompilation, which matches the
**US** release. The German release may store its text elsewhere. Follow
[docs/finding-addresses.md](docs/finding-addresses.md) and use
`tools/find_text.lua` to find the right addresses in a few minutes.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md). All six phases are implemented: adapter,
language pipeline, web UI, word bank with FSRS review, mini-games, and more
adapters (all Gen 3 games, OCR).

## Credits and data licences

The code is MIT-licensed ([LICENSE](LICENSE)). The data and tools below keep their own licences.

- Character encoding and RAM symbols: the [pret/pokeemerald](https://github.com/pret/pokeemerald) decompilation.
- Dictionary: [Wiktionary](https://en.wiktionary.org/) (CC BY-SA 4.0), via the
  [Kaikki.org](https://kaikki.org/) extract (wiktextract).
- Pokémon, move, ability, item and place names: [PokéAPI](https://github.com/PokeAPI/pokeapi) CSV data (BSD 3-Clause). Pokémon names are trademarks of Nintendo, Creatures and Game Freak.
- Scheduling: [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) (FSRS-6).
- Translation: [Opus-MT](https://github.com/Helsinki-NLP/Opus-MT) by Helsinki-NLP (CC BY 4.0),
  ONNX conversion `Xenova/opus-mt-de-en`, run with [transformers.js](https://github.com/huggingface/transformers.js).
- Inspired by Lexicart.
