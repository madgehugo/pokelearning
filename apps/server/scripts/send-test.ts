/**
 * Pretend to be a game adapter: connect, say hello, send a couple of lines.
 * Lets you test the server without mGBA: `npm run send-test`.
 */
import net from "node:net";
import { PROTOCOL_PORT, type AdapterMessage } from "@pokelearning/shared";

const port = Number(process.env.PORT ?? PROTOCOL_PORT);
const base = { adapter: "send-test", game: "pokemon-emerald-de" };

const sample = (line: string, source = "field"): AdapterMessage => ({
  type: "line",
  ...base,
  lang: "de",
  line,
  timestamp: Date.now(),
  meta: { source },
});

const messages: AdapterMessage[] = [
  { type: "hello", ...base, version: "0.0.0", timestamp: Date.now() },
  sample("Hallo! Willkommen in der Welt der POKéMON!"),
  sample("Möchtest du dich im POKéMON-CENTER ausruhen?"),
  sample("Ich bin PROF. BIRK. Die Leute nennen mich den POKéMON-PROFESSOR."),
  sample("Ruh dich gut aus! Dein POKéMON hat keine KP mehr."),
  sample("Ein wildes ZIGZACHS erscheint!", "battle"),
];

const socket = net.connect(port, "127.0.0.1", () => {
  for (const m of messages) socket.write(`${JSON.stringify(m)}\n`);
  socket.end();
  console.log(`sent ${messages.length} messages to 127.0.0.1:${port}`);
});
socket.on("error", (err) => {
  console.error(`could not reach the server on port ${port}: ${err.message}`);
  process.exitCode = 1;
});
