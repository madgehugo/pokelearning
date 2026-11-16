import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { ProcessedLine, ServerMessage, ServerStatus } from "@pokelearning/shared";
import { AppDb } from "../db/app-db.ts";
import { Games } from "../games/games.ts";
import { Setup } from "../setup/setup.ts";
import { Scheduler } from "../wordbank/scheduler.ts";
import { WordBank } from "../wordbank/wordbank.ts";
import { createUiServer, type UiServer } from "./server.ts";

describe("UI server", () => {
  const db = new AppDb(":memory:");
  const status: ServerStatus = { adapters: 1, game: "pokemon-emerald-de", adapterWarning: null, translator: "fake", dictionary: null };
  const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokelearning-web-"));
  fs.writeFileSync(path.join(staticDir, "index.html"), "<!doctype html><title>app</title>");
  let ui: UiServer;
  let base: string;

  before(async () => {
    for (const text of ["eins", "zwei", "drei"]) {
      const id = db.insertLine(
        { type: "line", adapter: "t", game: "pokemon-emerald-de", lang: "de", line: text, timestamp: 0 },
        Date.now(),
      );
      db.saveLineTranslation(id, "fake", `EN ${text}`);
    }
    const wordbank = new WordBank(db, new Scheduler());
    const setup = new Setup({
      namesReady: () => true,
      dictionaryReady: () => true,
      importNames: async () => {},
      importDictionary: async () => {},
      model: null,
      onImported: () => {},
    });
    ui = createUiServer({ db, wordbank, games: new Games(db, wordbank), setup, status: () => status, staticDir });
    await new Promise<void>((r) => ui.http.listen(0, "127.0.0.1", r));
    base = `127.0.0.1:${(ui.http.address() as AddressInfo).port}`;
  });
  after(() => ui.close());

  it("pages through history, newest first", async () => {
    const first = (await (await fetch(`http://${base}/api/lines?limit=2`)).json()) as ProcessedLine[];
    assert.deepEqual(first.map((l) => l.text), ["drei", "zwei"]);
    assert.equal(first[0]?.translation?.text, "EN drei");
    assert.equal(first[0]?.seenBefore, 0);
    const older = (await (await fetch(`http://${base}/api/lines?before=${first[1]!.id}`)).json()) as ProcessedLine[];
    assert.deepEqual(older.map((l) => l.text), ["eins"]);
  });

  it("serves the app, with the SPA fallback, and nothing outside it", async () => {
    for (const p of ["/", "/some/route", "/%2e%2e/%2e%2e/package.json"]) {
      const res = await fetch(`http://${base}${p}`);
      assert.equal(res.status, 200);
      assert.match(await res.text(), /<title>app<\/title>/);
    }
    assert.equal((await fetch(`http://${base}/api/nope`)).status, 404);
  });

  it("reports setup and makes backups only for this Mac", async () => {
    const s = (await (await fetch(`http://${base}/api/setup`)).json()) as { ready: boolean };
    assert.equal(s.ready, true);
    const file = path.join(staticDir, "backup.db");
    const post = (body: unknown) =>
      fetch(`http://${base}/api/backup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await post({ path: file })).status, 200);
    const copy = new AppDb(file);
    assert.equal(copy.recentLines(10).length, 3, "the copy has the lines");
    copy.close();
    assert.equal((await post({ path: "relative.db" })).status, 400);
    assert.equal((await post({ path: "/tmp/not-a-database.txt" })).status, 400);
  });

  it("rejects writes from other origins or without JSON", async () => {
    const post = (headers: Record<string, string>) =>
      fetch(`http://${base}/api/settings`, { method: "PUT", headers, body: JSON.stringify({ newPerDay: 5 }) });
    assert.equal((await post({ "content-type": "application/json", origin: "https://evil.example" })).status, 403);
    assert.equal((await post({ "content-type": "text/plain" })).status, 415);
    const ok = await post({ "content-type": "application/json", origin: `http://${base}` });
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { newPerDay: number }).newPerDay, 5);
    assert.equal((await fetch(`http://${base}/api/words/1`, { method: "DELETE", headers: { origin: "https://evil.example" } })).status, 403);
  });

  it("hides and shows words, and tells open views", async () => {
    const post = (p: string, body: unknown, origin?: string) =>
      fetch(`http://${base}${p}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
        body: JSON.stringify(body),
      });
    const ws = new WebSocket(`ws://${base}/ws`);
    const messages: ServerMessage[] = [];
    ws.addEventListener("message", (e) => messages.push(JSON.parse(String(e.data)) as ServerMessage));
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    const word = { lemma: "AP", pos: "noun", gloss: "PP" };
    assert.equal((await post("/api/hidden", word, "https://evil.example")).status, 403);
    assert.equal((await post("/api/hidden", word)).status, 204);
    await new Promise((r) => setTimeout(r, 50));
    const hidden = (m: ServerMessage) => (m.type === "wordbank" ? m.wordbank.hidden : undefined);
    assert.deepEqual(messages.map(hidden).findLast(Boolean), [word]);
    assert.equal((await post("/api/hidden/remove", { lemma: "AP", pos: "noun" })).status, 204);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(messages.map(hidden).findLast((h) => h !== undefined), []);
    ws.close();
  });

  it("sends a snapshot on connect, then live lines", async () => {
    const ws = new WebSocket(`ws://${base}/ws`);
    const messages: ServerMessage[] = [];
    const next = () =>
      new Promise<ServerMessage>((resolve) => {
        ws.addEventListener("message", (e) => resolve(JSON.parse(String(e.data)) as ServerMessage), { once: true });
      });
    const snapshot = await next();
    messages.push(snapshot);
    assert.equal(snapshot.type, "snapshot");
    assert.equal(snapshot.type === "snapshot" && snapshot.lines[0]?.text, "drei");
    assert.equal(snapshot.type === "snapshot" && snapshot.status.game, "pokemon-emerald-de");
    assert.deepEqual(snapshot.type === "snapshot" && snapshot.wordbank.saved, []);

    const live = next();
    ui.broadcastLine({ ...(snapshot.type === "snapshot" ? snapshot.lines[0]! : ({} as ProcessedLine)), id: 99, text: "vier" });
    const msg = await live;
    assert.equal(msg.type === "line" && msg.line.text, "vier");
    ws.close();
  });
});
