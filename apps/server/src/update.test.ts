import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkForUpdate } from "./update.ts";

const reply = (status: number, body: unknown) => async () => ({ ok: status < 400, status, json: async () => body });
const release = { tag_name: "v0.2.0", html_url: "https://github.com/x/y/releases/tag/v0.2.0" };

describe("checkForUpdate", () => {
  it("reports a newer release", async () => {
    assert.deepEqual(await checkForUpdate("0.1.0", "x/y", reply(200, release)), { version: "0.2.0", url: release.html_url });
  });

  it("says nothing when current, ahead, or without releases", async () => {
    assert.equal(await checkForUpdate("0.2.0", "x/y", reply(200, release)), null);
    assert.equal(await checkForUpdate("0.3.0", "x/y", reply(200, release)), null);
    assert.equal(await checkForUpdate("0.1.0", "x/y", reply(404, {})), null);
  });

  it("ignores odd tags and network failures", async () => {
    assert.equal(await checkForUpdate("0.1.0", "x/y", reply(200, { ...release, tag_name: "nightly" })), null);
    assert.equal(await checkForUpdate("0.1.0", "x/y", async () => { throw new Error("offline"); }), null);
  });
});
