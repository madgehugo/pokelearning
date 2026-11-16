# Finding text buffer addresses (German ROM)

The adapter reads dialogue from two RAM buffers. pokeemerald (US release, game
code `BPEE`) puts them here:

| Buffer | Symbol | US address | Size |
| --- | --- | --- | --- |
| field (NPCs, signs, scripts) | `gStringVar4` | `0x02021FC4` | 1000 |
| battle | `gDisplayedStringBattle` | `0x02022E2C` | 300 |

The German release (`BPED`) was built from slightly different code, so these
addresses may have moved. `games/emerald.lua` marks each buffer with `verified`.

**Status for `BPED` (German):** both buffers are confirmed in-game at the US
addresses. This guide stays here for other releases and other games.

## 1. Quick check: do the US addresses work?

Load `main.lua`, start the server and talk to an NPC. If a German line appears
in the server terminal, the field address is right. Start a battle to test the
battle address the same way. If it works, set that buffer's `verified = true` in
the `BPED` entry.

## 2. Search RAM for text you can see

1. Keep `main.lua` loaded (or don't, it doesn't matter) and also load
   `adapters/mgba-lua/tools/find_text.lua` via **File → Load script…**.
2. Talk to an NPC and **leave the text box open**. Pause the emulator if you
   like (**Emulation → Pause**). RAM keeps its contents while paused.
3. Type a distinctive word from the box into the console input, for example:

   ```lua
   find("Willkommen")
   ```

   Pick **one word** (line breaks are stored as special bytes) and copy the
   capitalisation exactly. Umlauts and ß work: `find("Größe")`. Game names
   are usually written in capitals with a lowercase é, as in `POKéMON`.

4. You get output like:

   ```
   EWRAM hit at 0x02021FC9  [inside field buffer 0x02021FC4 +5]
     string starts ~0x02021FC4: "Hallo! Willkommen in der Welt der POKéMON! …"
     from hit: "Willkommen in der Welt der POKéMON! …"
   find("Willkommen"): 1 hit(s)
   ```

   `[inside … buffer]` means the hit falls in a buffer the adapter already
   watches. "string starts" is a guess at the message start: the byte after the
   previous terminator, or after a run of filler bytes. If no start is found
   within 1000 bytes, it says "unclear". Watch the candidate to confirm it.

5. **Confirm it.** Watch the candidate and talk to a different NPC:

   ```lua
   watch(0x02021FC4)
   ```

   The right buffer prints the **new** message every time a new box opens.
   `unwatch()` stops watching. If there are several hits, watch each one.
   Pick the one that always starts at the same address. Old text is often
   still in RAM after the terminator, so a hit far into a buffer can point at
   stale text.

6. **Try it live** without editing files:

   ```lua
   pokelearning.setBuffer("field", 0x02021FC4)
   ```

7. Repeat in a battle (for example with "setzt" or the name of your Pokémon)
   to find the battle buffer: `pokelearning.setBuffer("battle", 0x0202....)`.

8. Write the confirmed addresses into the `BPED` entry in
   `adapters/mgba-lua/games/emerald.lua` and set that buffer's `verified = true`.

## 3. The text printer (repeated messages): automatic

You don't need to do anything here. After a few messages, the console prints
`field text printer found at 0x0300…`. This is the game's pointer to the
character being printed. From then on, a message shown twice in a row (the same
NPC again, or the same battle message) is sent again, marked "again". If it
stops working, the adapter notices and searches again. Once you know the
address, you can pin it in `games/emerald.lua` with `cursor = 0x0300…` on the
buffer.

## 4. Text printed straight from ROM (bag, Pokédex…)

Item descriptions and Pokédex entries never pass through the two buffers; the
game prints them directly from the ROM. You can register each screen once:

1. Open the bag and highlight an item, e.g. a Trank. Its description is on screen.
2. Search including the ROM:

   ```lua
   find("wiederherstellt", true)
   ```

   ```
   ROM hit at 0x08xxxxxx  string starts 0x08yyyyyy: "Ein Trank, der 20 KP wiederherstellt."
     next: findPointer(0x08yyyyyy) while this text is on screen
   ```

3. Find the RAM word pointing into that string (the printer's cursor):

   ```lua
   findPointer(0x08yyyyyy)
   ```

4. Confirm each candidate with `watchCursor(0x0300zzzz)` and move to another
   item. The right one prints the new description every time.
5. Try it live with `pokelearning.addCursor("bag", 0x0300zzzz)`, then add it
   to the `BPED` entry in `games/emerald.lua`:

   ```lua
   cursors = { { name = "bag", addr = 0x0300zzzz } },
   ```

The same steps work for the Pokédex (search for a word from an entry) and other
screens. Different screens often use different printers, so each gets its own
`cursors` entry. Text is sent once it has stayed on screen for about half a
second, so scrolling through the bag doesn't flood you.

## Other helpers

- `dump(0x02021FC4, 64)` shows a hex dump plus the decoded text. Use it to spot
  control codes or unknown bytes (shown as `[XX]` in the output).
- `strings(30)` lists every text-like string of 30+ characters in EWRAM. It
  helps when you don't know what to search for.

## Things to verify while you're at it

- **Quotation marks**: the German font draws bytes `B1`/`B2` as „ and “ (confirmed in Smaragd).
  `lib/charmap.lua` assumes this (`overrides.de`). If quotes look wrong in the
  terminal, adjust them there.
- **Unknown bytes**: if `[XX]` shows up in German text, the German charset uses
  a byte the US charmap doesn't map. Add it to `base` or `overrides.de` in
  `lib/charmap.lua`.

## Known limitations

- Screens that draw text without a text printer (e.g. the naming screen) are
  not captured.
