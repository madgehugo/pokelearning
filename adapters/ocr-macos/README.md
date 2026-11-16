# OCR adapter (macOS)

Reads the text box of any game window with Apple Vision and sends each finished
message to the Pokélearning server, like the mGBA adapter does. Use it for
games or emulators without a RAM adapter. It's local and free: Vision is part
of macOS.

```sh
npm run ocr:build                                  # once: compiles bin/ocr-capture (needs Xcode or the command line tools)
npm run ocr -- --list                              # windows you can read
npm run ocr -- --window mGBA --check               # what it reads now; saves the text area to ocr-check.png
npm run ocr -- --window mGBA --game pokemon-emerald-de
```

The first run asks for **Screen Recording** permission for your terminal
(System Settings → Privacy & Security → Screen & System Audio Recording).
Allow it, then start the adapter again.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `--window` | `mGBA` | First window whose app name or title contains this |
| `--game` | `pokemon-emerald-de` | Game id for the server (decides which Pokémon names apply) |
| `--lang` | `de` | Language of the text |
| `--crop x,y,w,h` | `0,0.62,1,0.38` | Text area, as fractions of the window from the top left. The default is the bottom 38%, where Gen 3 draws its text box. Check it with `--check` |
| `--interval` | `0.4` | Seconds between captures |
| `--host`, `--port` | `127.0.0.1`, `8765` | Server |

## How it decides what to send

Game text types out letter by letter, and OCR readings wobble slightly from
one capture to the next. A message is sent once two captures in a row agree,
ignoring spaces, case and punctuation. It is sent once while it stays on
screen, and again if it comes back after the box was empty (the same NPC twice).

Each text box page arrives as its own line. That differs from the mGBA adapter,
which sends a whole message at once.

Pixel fonts make Vision read *ß* as *B*. A capital B between lowercase letters
is never right in German, so "GrüBe" is corrected to "Grüße".

## Files

- `helper/OcrCapture.swift`: captures the window (ScreenCaptureKit), crops and
  scales the text area with sharp pixels, and reads it (Vision). It prints one
  JSON line per capture. It also reads an image file: `bin/ocr-capture --image shot.png`.
- `src/stabilizer.ts`: turns readings into finished messages.
- `src/index.ts`: runs the helper and talks to the server.
