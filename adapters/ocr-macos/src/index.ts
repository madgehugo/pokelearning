/**
 * OCR adapter for macOS: reads the text box of any game window with Apple
 * Vision (bin/ocr-capture) and sends finished messages to the server, like
 * the mGBA adapter does. For games or emulators without a RAM adapter.
 *
 *   npm run ocr -- --window mGBA --game pokemon-emerald-de
 *   npm run ocr -- --list                       which windows can be read
 *   npm run ocr -- --window mGBA --check        save the text area to ocr-check.png and print what it reads
 *
 * Options: --crop x,y,w,h (fractions of the window, default the bottom 38%),
 * --interval seconds (default 0.4), --lang de, --host, --port.
 */
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { styleText } from "node:util";
import { PROTOCOL_PORT, type AdapterMessage } from "@pokelearning/shared";
import { Stabilizer } from "./stabilizer.ts";

const ADAPTER = "ocr-macos";
const VERSION = "0.1.0";
const here = path.dirname(fileURLToPath(import.meta.url));

interface Options {
  window: string;
  game: string;
  lang: string;
  crop?: string;
  interval: string;
  host: string;
  port: number;
  helper: string;
  list: boolean;
  check: boolean;
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    window: "mGBA",
    game: "pokemon-emerald-de",
    lang: "de",
    interval: "0.4",
    host: "127.0.0.1",
    port: PROTOCOL_PORT,
    helper: path.resolve(here, "../bin/ocr-capture"),
    list: false,
    check: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    if (arg === "--window") o.window = value();
    else if (arg === "--game") o.game = value();
    else if (arg === "--lang") o.lang = value();
    else if (arg === "--crop") o.crop = value();
    else if (arg === "--interval") o.interval = value();
    else if (arg === "--host") o.host = value();
    else if (arg === "--port") o.port = Number(value());
    else if (arg === "--helper") o.helper = path.resolve(value());
    else if (arg === "--list") o.list = true;
    else if (arg === "--check") o.check = true;
    else throw new Error(`unknown option ${arg}`);
  }
  return o;
}

/** Newline-delimited JSON to the server, reconnecting, with a small queue while it's down. */
class Connection {
  private socket: net.Socket | null = null;
  private queue: string[] = [];
  private retry: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly hello: () => AdapterMessage,
  ) {
    this.connect();
  }

  private connect() {
    const socket = net.connect(this.port, this.host);
    socket.on("connect", () => {
      this.socket = socket;
      console.log(styleText("green", `connected to ${this.host}:${this.port}`));
      socket.write(`${JSON.stringify(this.hello())}\n`);
      for (const line of this.queue.splice(0)) socket.write(line);
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      if (this.socket === socket) console.log(styleText("yellow", "server connection closed, retrying…"));
      this.socket = null;
      clearTimeout(this.retry);
      this.retry = setTimeout(() => this.connect(), 2000);
    });
  }

  send(msg: AdapterMessage) {
    const line = `${JSON.stringify(msg)}\n`;
    if (this.socket) this.socket.write(line);
    else this.queue = [...this.queue, line].slice(-50);
  }
}

function helperArgs(o: Options): string[] {
  const args = ["--lang", o.lang === "de" ? "de-DE" : o.lang];
  if (o.crop) args.push("--crop", o.crop);
  if (o.list) return ["--list"];
  args.push("--window", o.window, "--interval", o.interval);
  if (o.check) args.push("--save", path.resolve("ocr-check.png"));
  return args;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const child = spawn(o.helper, helperArgs(o), { stdio: ["ignore", "pipe", "inherit"] });
  child.on("error", (err) => {
    console.error(`can't start ${o.helper} (${err.message}). Build it first: npm run ocr:build`);
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code ?? 0));

  const lines = readline.createInterface({ input: child.stdout });
  if (o.list) {
    lines.on("line", (l) => {
      const w = JSON.parse(l) as { app?: string; title?: string; error?: string };
      console.log(w.error ? styleText("red", w.error) : `${w.app}: ${w.title || "(no title)"}`);
    });
    return;
  }

  const connection = o.check
    ? null
    : new Connection(o.host, o.port, () => ({ type: "hello", adapter: ADAPTER, version: VERSION, game: o.game, timestamp: Date.now() }));
  const stabilizer = new Stabilizer();
  lines.on("line", (l) => {
    const r = JSON.parse(l) as { text?: string; confidence?: number; error?: string; status?: string };
    if (r.error) return console.error(styleText("red", r.error));
    if (r.status) return console.log(styleText("dim", r.status));
    if (o.check) {
      console.log(`read: ${JSON.stringify(r.text)} (confidence ${r.confidence}). The text area is in ocr-check.png.`);
      child.kill();
      return;
    }
    const text = stabilizer.push(r.text ?? "");
    if (!text) return;
    console.log(`${styleText("dim", `[${new Date().toLocaleTimeString("de-DE")}]`)} ${text}`);
    connection!.send({
      type: "line",
      adapter: ADAPTER,
      game: o.game,
      lang: o.lang,
      line: text,
      timestamp: Date.now(),
      meta: { source: "ocr", ...(r.confidence !== undefined ? { confidence: r.confidence } : {}) },
    });
  });
  process.on("SIGINT", () => {
    child.kill();
    process.exit(0);
  });
}

main();
