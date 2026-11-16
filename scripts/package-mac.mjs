// `npm run package`: build Pokélearning.app and a DMG to share (Apple Silicon).
//
//   npm run package                 → dist/Pokélearning-<version>-arm64.dmg
//   npm run package -- --no-smoke   skip the bundled-server test
//
// Downloads are pinned in packaging/manifest.json (sha256-checked) and cached
// in packaging/cache/. The app is signed ad hoc, not notarized: recipients
// allow it once in System Settings (see "Read me first.txt" in the DMG).
import { execFileSync, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { styleText } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "packaging/manifest.json"), "utf8"));
const cache = path.join(root, "packaging/cache");
const dist = path.join(root, "dist");
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version ?? "0.0.0";
const appName = "Pokélearning";
const app = path.join(dist, `${appName}.app`);
const contents = path.join(app, "Contents");
const resources = path.join(contents, "Resources");
const smoke = !process.argv.includes("--no-smoke");

const step = (text) => console.log(styleText("cyan", "package │ ") + text);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: "inherit", ...opts });
const out = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, encoding: "utf8", ...opts }).trim();
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const fail = (text) => {
  console.error(styleText("red", `package │ ${text}`));
  process.exit(1);
};
const lockVersion = (name) =>
  JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8")).packages[`node_modules/${name}`]?.version;

/** A pinned download from the manifest, from the cache or the network, checksum-verified. */
async function pinned(entry, file) {
  const dest = path.join(cache, file);
  if (!fs.existsSync(dest)) {
    step(`downloading ${entry.url}`);
    const res = await fetch(entry.url);
    if (!res.ok) fail(`download failed: HTTP ${res.status}`);
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }
  const actual = sha256(dest);
  if (actual !== entry.sha256) {
    fail(
      `${file} doesn't match its pin in packaging/manifest.json (got ${actual}).\n` +
        `  For mGBA's moving "latest" build this means a newer build came out: check it ` +
        `(\`--help\` must list --script), then update version, commit and sha256 in the manifest.`,
    );
  }
  return dest;
}

// 1. clean -----------------------------------------------------------------------------
step(`building ${appName} ${version}`);
fs.rmSync(app, { recursive: true, force: true });
fs.mkdirSync(path.join(contents, "MacOS"), { recursive: true });
fs.mkdirSync(path.join(resources, "licenses"), { recursive: true });

// 2. website ---------------------------------------------------------------------------
step("building the website");
run("npm", ["run", "build:web"], { stdio: ["ignore", "ignore", "inherit"] });
fs.cpSync(path.join(root, "apps/web/dist"), path.join(resources, "web"), { recursive: true });

// 3. server bundle -----------------------------------------------------------------------
step("bundling the server");
const NATIVE = ["@huggingface/transformers", "onnxruntime-node", "sharp"];
const esbuild = await import(path.join(root, "node_modules/esbuild/lib/main.js"));
const serverDir = path.join(resources, "server");
await esbuild.build({
  entryPoints: [path.join(root, "apps/server/src/index.ts")],
  outfile: path.join(serverDir, "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: NATIVE,
  legalComments: "external",
  // CommonJS dependencies (ws) call require() for Node built-ins
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: "warning",
});

step("installing the native translation packages");
const deps = { "@huggingface/transformers": lockVersion("@huggingface/transformers") };
fs.writeFileSync(path.join(serverDir, "package.json"), JSON.stringify({ name: "pokelearning-server", private: true, type: "module", dependencies: deps }, null, 2));
run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts", "--no-package-lock"], { cwd: serverDir, stdio: ["ignore", "ignore", "inherit"] });
// only macOS arm64 binaries, and not the browser runtime
const ort = path.join(serverDir, "node_modules/onnxruntime-node/bin");
for (const napi of fs.readdirSync(ort)) {
  for (const platform of fs.readdirSync(path.join(ort, napi))) {
    if (platform !== "darwin") fs.rmSync(path.join(ort, napi, platform), { recursive: true });
    else for (const arch of fs.readdirSync(path.join(ort, napi, platform))) if (arch !== "arm64") fs.rmSync(path.join(ort, napi, platform, arch), { recursive: true });
  }
}
fs.rmSync(path.join(serverDir, "node_modules/onnxruntime-web"), { recursive: true, force: true });

// 4. Lua adapter ---------------------------------------------------------------------------
fs.cpSync(path.join(root, "adapters/mgba-lua"), path.join(resources, "mgba-lua"), { recursive: true });

// 5. Node -------------------------------------------------------------------------------------
step(`adding Node ${manifest.node.version}`);
const nodeTar = await pinned(manifest.node, path.basename(manifest.node.url));
const nodeDir = `node-${manifest.node.version}-darwin-arm64`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pokelearning-package-"));
run("tar", ["-xJf", nodeTar, "-C", tmp, `${nodeDir}/bin/node`, `${nodeDir}/LICENSE`]);
fs.copyFileSync(path.join(tmp, nodeDir, "bin/node"), path.join(resources, "node"));
fs.chmodSync(path.join(resources, "node"), 0o755);
fs.copyFileSync(path.join(tmp, nodeDir, "LICENSE"), path.join(resources, "licenses/node.txt"));

// 6. mGBA ------------------------------------------------------------------------------------
step(`adding mGBA ${manifest.mgba.version}`);
const dmg = await pinned(manifest.mgba, manifest.mgba.file);
const mount = path.join(tmp, "mgba");
fs.mkdirSync(mount);
run("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mount, dmg], { stdio: "ignore" });
try {
  run("ditto", [path.join(mount, "mGBA.app"), path.join(resources, "mGBA.app")]); // keeps mGBA's own signature
  fs.mkdirSync(path.join(resources, "licenses/mgba"), { recursive: true });
  fs.copyFileSync(path.join(mount, "LICENSE"), path.join(resources, "licenses/mgba/LICENSE.txt"));
  if (fs.existsSync(path.join(mount, "licenses"))) fs.cpSync(path.join(mount, "licenses"), path.join(resources, "licenses/mgba"), { recursive: true });
} finally {
  run("hdiutil", ["detach", mount], { stdio: "ignore" });
}
const mgbaBin = path.join(resources, "mGBA.app/Contents/MacOS/mGBA");
if (!out("lipo", ["-archs", mgbaBin]).includes("arm64")) fail("the pinned mGBA has no arm64 code");
if (!spawnSync(mgbaBin, ["--help"], { encoding: "utf8" }).stdout.includes("--script")) fail("the pinned mGBA has no --script option");

// 7. app executable ---------------------------------------------------------------------------
step("compiling the app");
run("swiftc", [
  "-O", "-parse-as-library", "-target", "arm64-apple-macos14.0",
  "-o", path.join(contents, "MacOS/Pokelearning"),
  "apps/panel-macos/PanelCore.swift", "apps/desktop-macos/ScriptingWindow.swift", "apps/desktop-macos/Server.swift", "apps/desktop-macos/HotKeys.swift", "apps/desktop-macos/App.swift",
]);

// 8. icon -------------------------------------------------------------------------------------------
step("making the icon");
const iconset = path.join(tmp, "AppIcon.iconset");
fs.mkdirSync(iconset);
run("qlmanage", ["-t", "-s", "1024", "-o", tmp, path.join(root, "apps/web/public/icon.svg")], { stdio: "ignore" });
const big = path.join(tmp, "icon.svg.png");
if (!fs.existsSync(big)) fail("couldn't render the icon (qlmanage)");
for (const size of [16, 32, 128, 256, 512]) {
  run("sips", ["-z", String(size), String(size), big, "--out", path.join(iconset, `icon_${size}x${size}.png`)], { stdio: "ignore" });
  run("sips", ["-z", String(size * 2), String(size * 2), big, "--out", path.join(iconset, `icon_${size}x${size}@2x.png`)], { stdio: "ignore" });
}
run("iconutil", ["-c", "icns", iconset, "-o", path.join(resources, "AppIcon.icns")]);

// 9. Info.plist, notices, licences --------------------------------------------------------------
fs.writeFileSync(path.join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${appName}</string>
  <key>CFBundleDisplayName</key><string>${appName}</string>
  <key>CFBundleIdentifier</key><string>io.github.pokelearning.app</string>
  <key>CFBundleExecutable</key><string>Pokelearning</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.education</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>Includes mGBA (MPL-2.0). No games are included.</string>
</dict>
</plist>
`);
const notices = fs
  .readFileSync(path.join(root, "packaging/THIRD_PARTY_NOTICES.md"), "utf8")
  .replaceAll("{{MGBA_VERSION}}", manifest.mgba.version)
  .replaceAll("{{MGBA_SOURCE}}", manifest.mgba.source)
  .replaceAll("{{NODE_VERSION}}", manifest.node.version)
  .replaceAll("{{TRANSFORMERS_VERSION}}", deps["@huggingface/transformers"])
  .replaceAll("{{ONNXRUNTIME_VERSION}}", JSON.parse(fs.readFileSync(path.join(serverDir, "node_modules/onnxruntime-node/package.json"), "utf8")).version)
  .replaceAll("{{SHARP_VERSION}}", JSON.parse(fs.readFileSync(path.join(serverDir, "node_modules/sharp/package.json"), "utf8")).version);
fs.writeFileSync(path.join(resources, "THIRD_PARTY_NOTICES.md"), notices);
// licences of the installed packages and of the bundled JavaScript
for (const dir of fs.readdirSync(path.join(serverDir, "node_modules"), { recursive: true })) {
  if (/(^|\/)(LICEN[CS]E|NOTICE|COPYING)[^/]*$/i.test(dir) && !dir.includes("/node_modules/")) {
    const target = path.join(resources, "licenses/npm", dir.replaceAll("/", "__"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(serverDir, "node_modules", dir), target);
  }
}
for (const legal of fs.readdirSync(serverDir).filter((f) => f.endsWith(".LEGAL.txt"))) {
  fs.renameSync(path.join(serverDir, legal), path.join(resources, "licenses", `server-bundle-${legal}`));
}

// 10. sign -----------------------------------------------------------------------------------------
step("signing (ad hoc)");
run("codesign", ["--force", "--sign", "-", "--timestamp=none", path.join(contents, "MacOS/Pokelearning")]);
run("codesign", ["--force", "--sign", "-", "--timestamp=none", app]);
run("codesign", ["--verify", "--strict", app]);

// 11. smoke test: the bundled server translates a line ------------------------------------------
if (smoke) await smokeTest();

// 12. DMG ---------------------------------------------------------------------------------------------
step("building the DMG");
const stage = path.join(tmp, "dmg");
fs.mkdirSync(stage);
run("ditto", [app, path.join(stage, `${appName}.app`)]);
fs.symlinkSync("/Applications", path.join(stage, "Applications"));
fs.copyFileSync(path.join(root, "packaging/Read me first.txt"), path.join(stage, "Read me first.txt"));
fs.copyFileSync(path.join(resources, "THIRD_PARTY_NOTICES.md"), path.join(stage, "Third-party notices.md"));
const dmgOut = path.join(dist, `${appName}-${version}-arm64.dmg`);
fs.rmSync(dmgOut, { force: true });
run("hdiutil", ["create", "-volname", appName, "-srcfolder", stage, "-format", "UDZO", "-ov", dmgOut], { stdio: "ignore" });
fs.rmSync(tmp, { recursive: true, force: true });

const size = (p) => out("du", ["-sh", p]).split("\t")[0];
step(styleText("bold", `done: ${path.relative(root, dmgOut)} (${size(dmgOut)}; the app is ${size(app)})`));

// ------------------------------------------------------------------------------------------------------
async function smokeTest() {
  step("smoke test: starting the bundled server");
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "pokelearning-smoke-"));
  // reuse this checkout's downloaded data, so the test needs no downloads
  for (const f of ["dictionary.db", "pokemon-names.json", "models"]) {
    const src = path.join(root, "data", f);
    if (fs.existsSync(src)) fs.symlinkSync(src, path.join(data, f));
  }
  const env = { ...process.env, DATA_DIR: data, WEB_DIST_DIR: path.join(resources, "web"), PORT: "18765", UI_PORT: "18766", NO_COLOR: "1" };
  const server = spawn(path.join(resources, "node"), [path.join(serverDir, "server.mjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  const stop = (message) => {
    server.kill();
    fs.rmSync(data, { recursive: true, force: true });
    if (message) fail(`${message}\n--- server output ---\n${log}`);
  };
  const get = async (p) => (await fetch(`http://127.0.0.1:18766${p}`)).json();
  const wait = async (what, test, seconds) => {
    for (let i = 0; i < seconds * 4; i++) {
      try {
        if (await test()) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    stop(`smoke test: ${what} didn't happen`);
  };
  await wait("server start", async () => (await get("/api/status")).dictionary !== undefined, 30);
  const hasModel = fs.existsSync(path.join(root, "data/models"));
  if (hasModel) await wait("translation model load", async () => (await get("/api/status")).translator, 90);
  const socket = net.connect(18765, "127.0.0.1");
  await new Promise((r) => socket.on("connect", r));
  socket.end(JSON.stringify({ type: "line", adapter: "smoke", game: "pokemon-emerald-de", lang: "de", line: "Ein wildes ZIGZACHS erscheint!", timestamp: Date.now() }) + "\n");
  await wait("line processing", async () => {
    const [line] = await get("/api/lines?limit=1");
    return line && (!hasModel || line.translation) && line.analysis;
  }, 60);
  const [line] = await get("/api/lines?limit=1");
  const html = await (await fetch("http://127.0.0.1:18766/")).text();
  if (!html.includes("<title>Pokélearning</title>")) stop("smoke test: the website isn't served");
  step(`smoke test passed: "${line.text}" → "${line.translation?.text ?? "(no model in data/, not translated)"}"`);
  stop();
}
