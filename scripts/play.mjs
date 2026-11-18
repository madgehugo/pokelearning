// `npm run play`: everything for a play session, in one command.
//
//   npm run play -- ~/Games/smaragd.gba   first time: say which ROM (it's remembered)
//   npm run play                          afterwards
//   npm run play -- --lan                 also open the website to your phone
//   npm run play -- --no-mgba --no-panel  only the server
//
// It builds the web app, starts the server (or uses one that's already running),
// opens mGBA with your ROM, and starts the side panel next to it. The one thing
// left to do by hand is loading the Lua script in mGBA (mGBA 0.10 can't do that
// from the command line); its path is copied to the clipboard.
// Ctrl+C stops what this started.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { styleText } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
const memoryFile = path.join(dataDir, "play.json");
const script = path.join(root, "adapters/mgba-lua/main.lua");
const panelBin = path.join(root, "apps/panel-macos/bin/pokelearning-panel");
const uiPort = Number(process.env.UI_PORT ?? 8766);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const romArg = args.find((a) => !a.startsWith("--"));

const say = (text) => console.log(styleText("cyan", "play  │ ") + text);
const warn = (text) => console.log(styleText("yellow", "play  │ ") + text);

const children = [];
function stop() {
  for (const c of children) if (c.exitCode === null) c.kill("SIGINT");
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

// --- ROM (remembered) ---------------------------------------------------------
let memory = {};
try {
  memory = JSON.parse(fs.readFileSync(memoryFile, "utf8"));
} catch {}
let rom = romArg ? path.resolve(romArg.replace(/^~(?=\/)/, process.env.HOME ?? "~")) : memory.rom;
if (romArg) {
  if (!fs.existsSync(rom)) {
    warn(`There's no file at ${rom}.`);
    process.exit(1);
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(memoryFile, JSON.stringify({ ...memory, rom }, null, 2));
}
if (rom && !fs.existsSync(rom)) {
  warn(`The remembered ROM ${rom} is gone. Pass the new path: npm run play -- /path/to/rom.gba`);
  rom = undefined;
}

// --- data checks ------------------------------------------------------------------
if (!fs.existsSync(path.join(dataDir, "dictionary.db"))) warn("No dictionary yet: run `npm run dict:import` once for the word breakdown.");
if (!fs.existsSync(path.join(dataDir, "pokemon-names.json"))) warn("No game names yet: run `npm run names:import` once for Pokémon, moves and items.");

// --- web app and server -----------------------------------------------------------
const serverUp = async () => {
  try {
    return (await fetch(`http://localhost:${uiPort}/api/status`)).ok;
  } catch {
    return false;
  }
};

say("building the web app…");
const build = spawnSync("npm", ["run", "build:web"], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
if (build.status !== 0) {
  warn("The web app didn't build; see the errors above.");
  process.exit(1);
}

if (await serverUp()) {
  say(`using the server that's already running on port ${uiPort}`);
} else {
  say("starting the server…");
  const env = { ...process.env, ...(flag("--lan") ? { UI_HOST: "0.0.0.0" } : {}) };
  const server = spawn(path.join(root, "node_modules/.bin/tsx"), ["apps/server/src/index.ts"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(server);
  const prefix = styleText("dim", "server│ ");
  for (const stream of [server.stdout, server.stderr]) {
    let rest = "";
    stream.on("data", (chunk) => {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop();
      for (const l of lines) process.stdout.write(`${prefix + l}\n`);
    });
  }
  server.on("exit", (code) => {
    warn(`the server stopped (${code}).`);
    stop();
  });
  for (let i = 0; i < 60 && !(await serverUp()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await serverUp())) {
    warn("The server didn't start; see its output above.");
    stop();
  }
}

// --- mGBA ---------------------------------------------------------------------------
if (!flag("--no-mgba")) {
  const running = spawnSync("pgrep", ["-x", "mGBA"]).status === 0;
  if (running) {
    say("mGBA is already running, so it's left as it is.");
  } else if (rom) {
    say(`opening mGBA with ${path.basename(rom)}`);
    spawnSync("open", ["-a", "mGBA", rom]);
  } else {
    say("opening mGBA. Tip: npm run play -- /path/to/rom.gba opens your ROM directly next time.");
    spawnSync("open", ["-a", "mGBA"]);
  }
}

// --- side panel ---------------------------------------------------------------------
if (!flag("--no-panel")) {
  if (!fs.existsSync(panelBin)) {
    say("building the side panel (first time only)…");
    const r = spawnSync("npm", ["run", "panel:build"], { cwd: root, stdio: "inherit" });
    if (r.status !== 0) warn(`The panel didn't build. You can use the website instead: http://localhost:${uiPort}`);
  }
  if (fs.existsSync(panelBin)) {
    const panel = spawn(panelBin, ["--url", `http://localhost:${uiPort}/#/panel`], { stdio: "ignore" });
    children.push(panel);
    panel.on("exit", () => say("the panel was closed. The server keeps running; Ctrl+C stops it."));
  }
}

// --- the one manual step ----------------------------------------------------------
try {
  execFileSync("pbcopy", { input: script });
} catch {}
say("");
say(styleText("bold", "Last step, in mGBA: Tools → Scripting…, then File → Load script…"));
say(`and pick ${script}`);
say(styleText("dim", "(the path is on your clipboard: press ⌘⇧G in the file dialog and paste it)"));
say("");
say(`Website for review, words and games: http://localhost:${uiPort}`);
say(styleText("dim", "Ctrl+C stops the server and the panel."));
