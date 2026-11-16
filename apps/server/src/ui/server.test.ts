import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { ProcessedLine, ServerMessage, ServerStatus } from "@pokelearning/shared";
import { AppDb } from "../db/app-db.ts";
import { createUiServer, type UiServer } from "./server.ts";

describe("UI server", () => {
  const db = new AppDb(":memory:");
  const status: ServerStatus = { adapters: 1, game: "pokemon-emerald-de", translator: "fake", dictionary: null };
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
    ui = createUiServer({ db, status: () => status, staticDir });
    await new Promise<void>((r) => ui.http.listen(0, "127.0.0.1", r));
    base = `127.0.0.1:${(ui.http.address() as AddressInfo).port}`;
  });
  after(() => ui.close());

  it("pages through history, newest first", async () => {
    const first = (await (await fetch(`http://${base}/api/lines?limit=2`)).json()) as ProcessedLine[];
    assert.deepEqual(first.map((l) => l.text), ["drei", "zwei"]);
    assert.equal(first[0]?.translation?.text, "EN drei");
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

    const live = next();
    ui.broadcastLine({ ...(snapshot.type === "snapshot" ? snapshot.lines[0]! : ({} as ProcessedLine)), id: 99, text: "vier" });
    const msg = await live;
    assert.equal(msg.type === "line" && msg.line.text, "vier");
    ws.close();
  });
});
