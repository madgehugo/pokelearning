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
┌──────────── mGBA ────────────┐      TCP :8765        ┌──────── server (Node/TS) ────────┐   WebSocket   ┌─── web UI (React/Vite) ───┐
│ Lua game adapter             │  newline-delimited    │ ingest → tokenize → dictionary   │ ────────────▶ │ live line, translation,   │
│ watches text buffers, decodes│ ───────JSON─────────▶ │ → translate → SQLite             │   (phase 3)   │ word breakdown, word bank,│
│ Gen 3 charset → UTF-8        │  { game, line, ts }   │                                  │               │ FSRS review (phone too)   │
└──────────────────────────────┘                       └──────────────────────────────────┘               └───────────────────────────┘
```

Adapters are plug-ins. Anything that can produce
`{ type: "line", adapter, game, line, timestamp }` can feed the server: another
game module, another emulator, or an OCR adapter. See
[docs/adapter-protocol.md](docs/adapter-protocol.md).

## Repo layout

| Path | What |
| --- | --- |
| `adapters/mgba-lua/` | mGBA Lua adapter: `main.lua` entry, `lib/` (charmap, JSON, transport), `games/` (per-game plug-ins), `tools/find_text.lua` (RAM search) |
| `packages/shared/` | TypeScript types shared by adapters, server and UI: adapter protocol, line analysis |
| `apps/server/` | Node server: ingest → word-by-word analysis → translation → SQLite (see [docs/language-pipeline.md](docs/language-pipeline.md)) |
| `apps/web/` | Browser UI: React + Vite, responsive, live over WebSocket |
| `docs/` | Roadmap, protocol, address-finding guide |

## Quick start

Requirements: Node 22.13+ (tested on 26; uses the built-in `node:sqlite`), mGBA 0.10+ (tested on 0.10.5).

```sh
npm install
npm run dict:import       # once: downloads the Wiktionary extract (~100 MB) and builds data/dictionary.db (~15 s)
npm start                 # builds the web app and starts the server; open http://localhost:8766
```

The first start downloads the translation model (~110 MB). Then load the Lua
script in mGBA (below) and talk to someone. Each line shows up in the browser:
the German text in a dialogue box, its English translation, and every word with
its dictionary form, der/die/das (colour-coded: blue, rose, green) and meaning.
Tap a word for its grammar ("feminine singular, nominative or accusative"),
all its meanings, and the other readings it could have. ← and → move between
words.

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

Everything is local and free: no accounts or API keys. Downloaded data and your
database live in `data/` (git-ignored). Set `TRANSLATOR=none` to turn off
translation.

**On your phone:** start with `UI_HOST=0.0.0.0 npm start` and open the address
the server prints (`http://192.168.…:8766`) on a phone on the same Wi-Fi. On
iOS, *Share → Add to Home Screen* gives it its own icon. Only the web UI is
opened to the network; the adapter port stays local.

**Developing:**

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

### If no lines appear: finding the German addresses

The buffer addresses come from the pokeemerald decompilation, which matches the
**US** release. The German release may store its text elsewhere. Follow
[docs/finding-addresses.md](docs/finding-addresses.md) and use
`tools/find_text.lua` to find the right addresses in a few minutes.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md). Phases 1–4 (adapter, language pipeline,
web UI, word bank with FSRS review) are implemented; next are mini-games.

## Credits and data licences

- Character encoding and RAM symbols: the [pret/pokeemerald](https://github.com/pret/pokeemerald) decompilation.
- Dictionary: [Wiktionary](https://en.wiktionary.org/) (CC BY-SA 4.0), via the
  [Kaikki.org](https://kaikki.org/) extract (wiktextract).
- Scheduling: [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) (FSRS-6).
- Translation: [Opus-MT](https://github.com/Helsinki-NLP/Opus-MT) by Helsinki-NLP (CC BY 4.0),
  ONNX conversion `Xenova/opus-mt-de-en`, run with [transformers.js](https://github.com/huggingface/transformers.js).
- Inspired by Lexicart.
