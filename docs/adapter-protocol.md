# Adapter protocol

Adapters connect to the server over **TCP on `127.0.0.1:8765`** (configurable)
and send **newline-delimited JSON**: one UTF-8 JSON object per line. The
connection is one-way for now; the server sends nothing back.

TypeScript types and a validator live in
[`packages/shared/src/index.ts`](../packages/shared/src/index.ts).

## `hello`

Sent once right after connecting.

```json
{ "type": "hello", "adapter": "mgba-gen3", "version": "0.1.0", "game": "pokemon-emerald-de", "timestamp": 1731750000000 }
```

## `line`

One complete piece of dialogue (a whole message, which can span several text-box pages).

```json
{
  "type": "line",
  "adapter": "mgba-gen3",
  "game": "pokemon-emerald-de",
  "lang": "de",
  "line": "Möchtest du ein POKéMON-Center sehen?",
  "timestamp": 1731750000000,
  "meta": {
    "source": "field",
    "pages": ["Möchtest du ein POKéMON-\nCenter sehen?"],
    "gameCode": "BPED",
    "address": "0x02021FC4"
  }
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `type` | yes | `"hello"` or `"line"` |
| `adapter` | yes | Adapter implementation id |
| `game` | yes | Stable game id: `<series>-<title>-<lang>` |
| `line` | yes (line) | Text with layout line breaks flattened to single spaces. A hyphen at a line break is kept (`POKéMON-Center`). |
| `timestamp` | yes | Unix epoch **milliseconds**; `0` if unknown |
| `lang` | no | Language of the text |
| `meta` | no | Adapter-specific. Conventions: `source` (`field`, `battle`, `bag`…) and `pages`. |

Send a line every time it appears on screen, including repeats (the same NPC
twice). The server counts how often each line came up (`seenBefore`), so
adapters don't need to track that.

## Writing a new adapter

- **Gen 3 games for mGBA** are all covered by `adapters/mgba-lua/games/gen3.lua`,
  which finds text buffers by itself. Known addresses for a title go in
  `games/<title>.lua` (like `games/emerald.lua`) and are listed in `KNOWN` there.
- **Another game family for mGBA**: add a module exporting `name`,
  `matches(gameCode)` and `config(gameCode)`, where `config` returns
  `{ game, lang, title?, buffers = { { name, addr, size, verified, cursor? } }, cursors?, discover? }`.
  Register it in `GAMES` in `main.lua`. A different character set also needs
  its own decoder in place of `lib/charmap.lua`.
- **Any game on screen**: the OCR adapter in `adapters/ocr-macos` already speaks
  this protocol; use `--game` to set the game id.
- **Anything else** (OCR, another emulator): open a TCP connection, send
  `hello`, then one `line` per new dialogue line.
