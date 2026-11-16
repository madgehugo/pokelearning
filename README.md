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
| `packages/shared/` | TypeScript types and validator for the adapter protocol |
| `apps/server/` | Node server (phase 1: receives lines and prints them) |
| `apps/web/` | Browser UI (phase 3) |
| `docs/` | Roadmap, protocol, address-finding guide |

## Quick start

Requirements: Node 20.12+ (tested on 26), mGBA 0.10+ (tested on 0.10.5).

```sh
npm install
npm run dev:server        # listens on 127.0.0.1:8765
npm run send-test         # optional: in a second terminal, sends fake lines
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
5. Talk to someone. The line shows up in the server terminal and in the mGBA console.

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

See [docs/ROADMAP.md](docs/ROADMAP.md). Phase 1 (adapter + ingest) is what is
implemented now.

## Credits

Character encoding and RAM symbols come from the
[pret/pokeemerald](https://github.com/pret/pokeemerald) decompilation.
Inspired by Lexicart.
