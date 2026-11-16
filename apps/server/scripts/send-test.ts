/**
 * Pretend to be a game adapter: connect, say hello, send a couple of lines.
 * Lets you test the server without mGBA: `npm run send-test`.
 */
import net from "node:net";
import { PROTOCOL_PORT, type AdapterMessage } from "@pokelearning/shared";

const port = Number(process.env.PORT ?? PROTOCOL_PORT);
const base = { adapter: "send-test", game: "pokemon-emerald-de" };

const messages: AdapterMessage[] = [
  { type: "hello", ...base, version: "0.0.0", timestamp: Date.now() },
  {
    type: "line",
    ...base,
    lang: "de",
    line: "Hallo! Willkommen in der Welt der POKéMON!",
    timestamp: Date.now(),
    meta: { source: "field", pages: ["Hallo! Willkommen in der Welt der\nPOKéMON!"] },
  },
  {
    type: "line",
    ...base,
    lang: "de",
    line: "Möchtest du dich im POKéMON-Center ausruhen? Süß, groß, Übung!",
    timestamp: Date.now(),
    meta: { source: "field" },
  },
];

const socket = net.connect(port, "127.0.0.1", () => {
  for (const m of messages) socket.write(JSON.stringify(m) + "\n");
  socket.end();
  console.log(`sent ${messages.length} messages to 127.0.0.1:${port}`);
});
socket.on("error", (err) => {
  console.error(`could not reach the server on port ${port}: ${err.message}`);
  process.exitCode = 1;
});
