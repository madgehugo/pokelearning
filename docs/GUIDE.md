# Pokélearning user guide

Pokélearning runs next to mGBA while you play German Pokémon Smaragd. Every
time a text box appears in the game, a side panel next to the emulator shows:

- the German line,
- its English translation,
- every word, with its dictionary form, *der/die/das* and meaning.

Words you save go into a word bank. You review them on the website with spaced
repetition (FSRS) and practise them in mini-games. Everything runs on your Mac:
no accounts, no API keys, no cost.

```
┌──────── mGBA ────────┐┌─ Pokélearning ─────┐    website (http://localhost:8766)
│                      ││ FLEMMLI setzt GLUT │    ├ Live     the same as the panel, with history
│      the game        ││ ein!               │    ├ Review   your cards for today
│                      ││ Torchic uses Ember!│    ├ Words    your word bank
│ FLEMMLI setzt GLUT   ││ FLEMMLI  Torchic   │    └ Games    article sprint, fill the gap,
│ ein!                 ││ GLUT     Ember  …  │               listening, matching
└──────────────────────┘└────────────────────┘
```

**Contents**

0. [Install the app](#0-install-the-app) (the easy way)
1. [Setting up from source](#1-setting-up-from-source-for-developers) (for developers)
2. [Every time you play](#2-every-time-you-play)
3. [Using it](#3-using-it): panel, website, review, games, phone
4. [Other games and emulators](#4-other-games-and-emulators)
5. [How it works](#5-how-it-works)
6. [Troubleshooting](#6-troubleshooting)
7. [Updating, backing up and resetting](#7-updating-backing-up-and-resetting)

---

## 0. Install the app

The easiest way: **Pokélearning.app** has everything built in, mGBA included.
You need a Mac with Apple Silicon (M1 or newer) and macOS 14 or newer.

1. Open `Pokélearning-<version>-arm64.dmg` and drag **Pokélearning** into
   **Applications**.
2. Open it from Applications. The app isn't signed with a paid Apple developer
   account, so the first time macOS blocks it:
   - Click **Done** in the message.
   - Open **System Settings → Privacy & Security**, scroll down to
     *"Pokélearning" was blocked…*, and click **Open Anyway**.
   - Confirm with **Open Anyway** and your password.

   You only do this once.
3. **Choose your game**: the `.gba` file of your Pokémon game, dumped from your
   own cartridge (e.g. Pokémon Smaragd). The app remembers it. No games are
   included.
4. **First-time setup** downloads the German dictionary, the game names and the
   translation model (about 230 MB), with a progress window. It takes a few
   minutes, once. After that, everything works offline.

From then on, **open Pokélearning to play**. The game starts in mGBA with the
companion already running, and the panel docks next to it. There's nothing else
to load. Quitting mGBA quits the app.

The app's menus:
- **Go**: Live, Review, Words and Games, in your browser (⌘1–⌘4).
- **Panel**: Show Panel (⌃⌥P) and Dock Next to mGBA (⌃⌥D). These also work while the game has the keyboard; ⌘P would pause mGBA.
- **File**:
  - Change ROM…
  - Back Up Progress… and Restore Progress…
  - Show Data Folder and Show Logs
- **Phone**: Allow Phone Access shows the address to open on your phone.

**Sharing it:** give someone the DMG. They need their own ROM dump, and their
progress is their own. To move *your* progress to another Mac, use
**File → Back Up Progress…** here and **File → Restore Progress…** there.
Restore Progress also takes the `data/app.db` of a from-source setup.

## 1. Setting up from source (for developers)

You need Node 22.13 or newer, mGBA 0.10 or newer, and Xcode or Apple's command
line tools (to build the side panel). In the project folder:

```sh
npm install
npm run dict:import     # German dictionary from Wiktionary: ~100 MB download, ~15 s to build
npm run names:import    # Pokémon, move, item, ability and place names from PokéAPI
npm run play -- ~/Games/Pokemon-Smaragd.gba     # the path to your own ROM dump
```

The first start also downloads the translation model (~110 MB) and builds the
side panel. After that, everything works offline.

## 2. Every time you play

**With the app:** open Pokélearning. That's all: the game, the companion and
the panel start together. The rest of this section is for running from source.

```sh
npm run play
```

This one command:

1. builds the website and starts the server (or uses one that's already running),
2. opens mGBA with your ROM (it remembers the path from the first time),
3. opens the side panel, which docks to the right of the mGBA window.

**One step is left to do by hand**, because mGBA 0.10 can't load scripts from
the command line. In mGBA:

1. **Tools → Scripting…**
2. **File → Load script…** and pick `adapters/mgba-lua/main.lua`. The path is
   already on your clipboard: press **⌘⇧G** in the file dialog and paste it.

The scripting console should say:

```
[pokelearning] Pokémon Smaragd detected (game code BPED, language de)
[transport] connected to 127.0.0.1:8765
```

The panel's status turns from *Load the script in mGBA* to *Live*. Talk to
someone, and the line appears in the panel. You can move the scripting window
out of the way; it only has to stay open.

To stop, close the panel and press **Ctrl+C** in the terminal. mGBA keeps
running until you quit it.

## 3. Using it

### The side panel

- **The dialogue box** shows the current line. Words are underlined in their
  gender colour: **blue = der**, **red = die**, **green = das**.
- **Tap a word** (in the box or in the list) for its grammar ("feminine
  singular, nominative or accusative"), all its meanings, and other readings it
  could have. Separable verbs are shown as one word: in *Ruh dich gut aus!*,
  *Ruh* and *aus* are both *ausruhen*.
- **Save word** puts the word in your word bank, with the sentence it came from.
  Saved words get an amber dot. If the reading is wrong, open the word and
  choose **Save this reading** on one of the alternatives instead.
- **Hide this word** (in an open word) removes it from the list under the line,
  for words you already know or don't want to see, such as *AP* (a move's PP).
  The word stays in the sentence as plain text. **Hidden (n)** at the bottom
  lists them, with **Show again**. Hiding applies to the website's live view too,
  and doesn't affect your word bank or reviews.
- **‹ Earlier** steps back through recent lines; **Latest ›** returns.
- **Review, Words, Games** at the bottom open the website in your browser.
  The number next to Review is how many cards are due.
- The panel stays on top of the game (it hides while another app is in front) and follows mGBA when you move it.
  Clicking in it doesn't take the keyboard away from the game. If you drag the
  panel somewhere else, it stays there. **Dock** (it appears in the panel once you have moved it) puts it back next to mGBA.

### The website

Open **http://localhost:8766**:

- **Live**: the current line like in the panel, plus your history. Tap an
  earlier line to read it again. ← and → move between words.
- **Review**: one card at a time, scheduled with FSRS.
  - *Meaning*: the German word and its sentence. Think of the meaning, show the
    answer, then grade yourself: Again, Hard, Good or Easy. Each button shows
    when the card comes back.
  - *Article* (nouns): tap der, die or das.
  - *Recall* (optional): the English meaning → the German word.

  Keys: **Space** shows the answer, **1–4** grade, **1–3** pick an article. A
  noun's article card comes the day after its meaning card.
- **Words**: your word bank, with search. Each word shows the sentences it came
  from in the game, how often you've met it, and when it's due. Turn on recall
  cards and change the number of new cards per day (default 20) at the bottom.
- **Games**:
  - *Article sprint*: 60 seconds of der/die/das.
  - *Fill the gap*: a line from your game with one word missing.
  - *Listening*: a German voice reads a line, and you pick what it means. **R**
    replays it, **Shift+R** plays it slower.
  - *Matching*: pair six words with their meanings against the clock.

  Games use your saved words first, then words from what you've played. They
  don't change your review schedule.

### On your phone

Start with `npm run play -- --lan`. The terminal prints an address like
`http://192.168.1.20:8766`: open it on a phone on the same Wi-Fi. On iOS,
**Share → Add to Home Screen** gives it an icon. Only the website is opened to
your network; the emulator connection stays on your Mac.

## 4. Other games and emulators

- **Other Gen 3 Pokémon games in mGBA** (Ruby, Sapphire, FireRed, LeafGreen;
  German, English, French, Italian, Spanish): load the same script. The adapter
  doesn't know these games' memory addresses yet, so it finds them while you
  play. After about three messages the console says `found a text buffer at
  0x…`, and lines start coming in. The first two messages are used for that
  search. FireRed and LeafGreen get Kanto's place names.
- **Any other game or emulator**: the screen-reading adapter reads the text box
  from the window with Apple Vision. See [adapters/ocr-macos/README.md](../adapters/ocr-macos/README.md).

## 5. How it works

```
mGBA + Lua script ──TCP 8765──▶ server ──WebSocket──▶ panel and website
(reads the game's RAM)          │ dictionary lookup (Wiktionary)
                                │ Pokémon names (PokéAPI)
                                │ translation (Opus-MT, on your Mac)
                                └ SQLite: data/app.db
```

1. **The Lua script** (`adapters/mgba-lua/main.lua`) runs inside mGBA. Gen 3
   games write every message to a buffer in RAM before printing it. The script
   watches that buffer, decodes the game's character set (including ä ö ü ß),
   and sends each new message to the server. It also notices when the same
   message is shown again.
2. **The server** (`apps/server`) analyses each word against a German dictionary
   built from Wiktionary. It recognises Pokémon, moves, items, abilities and
   places (written in capitals in Gen 3), and translates the line with Opus-MT,
   a translation model that runs on your Mac. Pokémon names go to the
   translator as placeholders and come back in English, so FLEMMLI becomes
   *Torchic*, not a garbled word.
3. **The panel and website** (`apps/web`, `apps/panel-macos`) get every line the
   moment it's ready, and talk to the server to save words, review and play.

More detail: [language pipeline](language-pipeline.md), [adapter
protocol](adapter-protocol.md), [finding memory addresses](finding-addresses.md).

### Where your data lives

With the app, these live in `~/Library/Application Support/Pokélearning/`
(**File → Show Data Folder**). The app's log is in
`~/Library/Logs/Pokélearning/server.log` (**File → Show Logs**). From source,
they're in the repo's `data/` folder.

| File | What | If you delete it |
| --- | --- | --- |
| `data/app.db` | **Your history, word bank, reviews and game results** | They're gone: back it up |
| `data/dictionary.db`, `data/kaikki-german.jsonl.gz` | Dictionary | `npm run dict:import` |
| `data/pokemon-names.json` | Game names | `npm run names:import` |
| `data/models/` | Translation model | Downloaded again on start |
| `data/play.json` | Your ROM path | `npm run play -- /path/to/rom.gba` |

Your ROM, saves and save states are never copied or committed.

## 6. Troubleshooting

Start with the two status lines: the panel's (or the website's top bar), and
`pokelearning.status()`, which you can type into mGBA's scripting console.

### The app

| What you see | Why | Fix |
| --- | --- | --- |
| *Apple could not verify "Pokélearning"…* | The app isn't notarized by Apple | System Settings → Privacy & Security → **Open Anyway** (section 0). Once only |
| mGBA's scripting window covers the game and the panel | mGBA opens it whenever a script is loaded. The app can close it, but only with the Accessibility permission, and macOS forgets that permission when the app is updated (it isn't notarized) | **Panel → Hide mGBA Scripting Window…** opens the right Settings pane: remove the old Pokélearning entry under Privacy & Security → Accessibility, add the current one, and switch it on. Or close the window by hand; the script keeps running |
| *"Pokélearning" is damaged and can't be opened* | Some ways of copying files (some browsers, AirDrop) mark unsigned apps like this | In Terminal: `xattr -dr com.apple.quarantine /Applications/Pokélearning.app`, then open it again |
| *Port 8766 is already in use* | The companion is already running from a terminal (`npm run play`) | Stop that one (Ctrl+C), then open the app again |
| Setup says *No internet connection* | A download failed | Connect, then **Try again**. Finished steps aren't downloaded again |
| *mGBA didn't start* | The app is incomplete | Download the DMG again and replace the app |
| *The companion server stopped* | It crashed | **Restart**. If it happens again, File → Show Logs and send the log |
| The panel is gone | It was closed | **Panel → Show Panel**, press ⌃⌥P, or click the Pokélearning icon in the Dock |
| The wrong game starts | A different ROM was chosen | **File → Change ROM…** |
| mGBA's keys or settings differ from your own mGBA | The app's mGBA shares settings with any mGBA you have installed (`~/.config/mGBA`) | Change them in mGBA's settings as usual |

### Starting up (from source)

| What you see | Why | Fix |
| --- | --- | --- |
| `Port 8765 is already in use` or `Port 8766 is already in use` | A server is already running, maybe in another terminal | Use that one, or stop it (Ctrl+C there). `npm run play` reuses a running server by itself |
| `No dictionary yet` / `no dictionary found` | The dictionary wasn't imported | `npm run dict:import` |
| `No game names yet` | The names weren't imported | `npm run names:import`, then `npm run reprocess` |
| `translation model failed to load` | The first download didn't finish (no internet) | Connect, restart. Lines still arrive meanwhile, just untranslated |
| `The panel didn't build` | Xcode / command line tools are missing | `xcode-select --install`, then `npm run panel:build`. Meanwhile use the website |
| Node errors about `node:sqlite` | Node is too old | Install Node 22.13 or newer |

### mGBA and the script

| What you see | Why | Fix |
| --- | --- | --- |
| Panel says *Load the script in mGBA* | The script isn't loaded, or it can't reach the server | Load `main.lua` (section 2). Check the scripting console for errors |
| Console: `server not reachable at 127.0.0.1:8765 … retrying…` | The server isn't running | Start it (`npm run play`). The script connects by itself; lines seen meanwhile are sent when it does |
| Console: `unsupported game code 'XXXX', adapter idle` | Not a Gen 3 Pokémon game, or a Japanese one | Use the [OCR adapter](../adapters/ocr-macos/README.md) |
| `waiting for a game to start…` | No ROM is loaded | Load the ROM; the script picks it up |
| Nothing happens after editing a Lua file | The old version is still running | Load `main.lua` again; it replaces itself cleanly |

### Lines and text

| What you see | Why | Fix |
| --- | --- | --- |
| No lines at all, but the console says *connected* | The game's text buffer address is wrong or unknown | Other games: talk to a few people until `found a text buffer`. Emerald: follow [finding-addresses.md](finding-addresses.md) |
| Talking to the same person twice shows nothing the second time | The adapter hasn't found the game's text printer yet | Talk to two or three different people first, until the console says `text printer found`. `pokelearning.status()` shows the search |
| Odd codes like `[A3]` in a line | A character the decoder doesn't know | Add it to `adapters/mgba-lua/lib/charmap.lua` (see finding-addresses.md) |
| Item descriptions and Pokédex entries don't appear | They're printed straight from the ROM, not through the message buffer | Register them once: finding-addresses.md, section 4 |
| A menu shows no translation | The menu hook couldn't find the game's text printer | The console says `couldn't find the game's text printer`. The adapter looks for it by its code (`adapters/mgba-lua/lib/menu.lua`); it is confirmed on Pokémon Smaragd only |
| The naming screen, some other screens | Drawn without the text printer | Not captured. The OCR adapter can read them |

### Words and translations

| What you see | Why | Fix |
| --- | --- | --- |
| A word has the wrong reading | German is ambiguous; the ranking is a heuristic | Open the word: the right one is usually under *Could also be*. Save that reading |
| *not in the dictionary* | Trainer names, rare words, compounds without a hyphen | For names, add them to `apps/server/src/language/glossary/pokemon-de.json` |
| A Pokémon or move isn't recognised | Gen 3 sometimes shortened names that today's games spell out | Add the Gen 3 spelling to `glossary/pokemon-de.json` (it overrides imported names) |
| A translation is odd | Opus-MT is a small offline model | Rely on the word breakdown. The translation is cached, so it stays the same |
| Old lines don't have new names or fixes | They were analysed before | `npm run reprocess` (stop the server first) |
| *Translating…* stays | The model is still loading | Wait for `translation model ready` in the terminal |

### Panel and website

| What you see | Why | Fix |
| --- | --- | --- |
| The panel doesn't follow mGBA | You moved it yourself, or mGBA's window isn't on screen | Click **Dock** in the panel |
| The panel sits over the game | There's no room beside mGBA on that screen | Make mGBA smaller or move it left; the panel goes left of mGBA if there's no room on the right |
| *Waiting for the Pokélearning server…* in the panel | The server isn't running | Start it; the panel connects by itself |
| Website: *Server not running* | Same | Same |
| The phone can't open the address | Started without `--lan`, a different Wi-Fi, or the macOS firewall | `npm run play -- --lan`; allow incoming connections for Node if macOS asks |

### Review and games

| What you see | Why | Fix |
| --- | --- | --- |
| *Nothing to review right now* with words saved | New cards are limited per day, and a noun's article card waits a day | Normal. Raise *New cards per day* under Words if you like |
| A game says *Not enough material yet* | It needs a few lines or nouns from your game | Play a bit more, or save words |
| Listening: *This browser has no German voice* | No German text-to-speech voice is installed | macOS: System Settings → Accessibility → Spoken Content → System voice → Manage voices → add a German voice (e.g. Anna) |

### OCR adapter

See [adapters/ocr-macos/README.md](../adapters/ocr-macos/README.md). The usual
problems:

| What you see | Why | Fix |
| --- | --- | --- |
| `can't list windows` | No Screen Recording permission for your terminal | System Settings → Privacy & Security → Screen & System Audio Recording |
| Text is cut off or missing | The text area is cropped wrong | `npm run ocr -- --window mGBA --check` saves the crop to `ocr-check.png`; adjust `--crop` |

## 7. Updating, backing up and resetting

- **Back up your progress**: in the app, **File → Back Up Progress…**. From
  source, copy `data/app.db` while the server isn't running.
- **Update the dictionary or names**: `npm run dict:import` or
  `npm run names:import`, then `npm run reprocess` so old lines pick them up.
- **Forget your history and word bank**: stop the server and delete
  `data/app.db` (keep a copy if you might want it back). A new one is created
  on the next start.
- **Run the tests**: `npm test`.
