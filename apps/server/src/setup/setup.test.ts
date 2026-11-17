import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderStatus } from "../translate/provider.ts";
import { Setup, type SetupDeps } from "./setup.ts";

function fakeDeps(overrides: Partial<SetupDeps> = {}) {
  const log: string[] = [];
  let model: ProviderStatus = { state: "idle", progress: null, detail: "" };
  const deps: SetupDeps = {
    namesReady: () => false,
    dictionaryReady: () => false,
    importNames: async (p) => {
      log.push("names");
      p(0.5, "Downloading game names (3 of 6)");
    },
    importDictionary: async (p) => {
      log.push("dictionary");
      p(0.3, "Downloading the dictionary: 30 of 100 MB");
    },
    model: {
      status: () => model,
      warmUp: async () => {
        log.push("model");
        model = { state: "ready", progress: 1, detail: "Translation model ready" };
      },
    },
    onImported: (step) => log.push(`loaded ${step}`),
    ...overrides,
  };
  return { deps, log };
}

describe("Setup", () => {
  it("starts with what's there and what's missing", () => {
    const { deps } = fakeDeps({ namesReady: () => true });
    const s = new Setup(deps).status();
    assert.deepEqual(s.steps.map((x) => [x.id, x.state]), [["names", "ready"], ["dictionary", "missing"], ["model", "waiting"]]);
    assert.equal(s.ready, false);
  });

  it("downloads names, then the dictionary, then the model, loading each", async () => {
    const { deps, log } = fakeDeps();
    const setup = new Setup(deps);
    await setup.start();
    assert.deepEqual(log, ["names", "loaded names", "dictionary", "loaded dictionary", "model"]);
    assert.equal(setup.status().ready, true);
  });

  it("reports progress while running", async () => {
    let seen: string | undefined;
    const { deps } = fakeDeps({
      importDictionary: async (p) => {
        p(0.4, "Building the dictionary: 120,000 entries");
        seen = setup.status().steps.find((x) => x.id === "dictionary")?.detail;
      },
    });
    const setup = new Setup(deps);
    await setup.start();
    assert.equal(seen, "Building the dictionary: 120,000 entries");
  });

  it("says what went wrong, and retries only what failed", async () => {
    let fail = true;
    const { deps, log } = fakeDeps({
      importDictionary: async () => {
        log.push("dictionary");
        if (fail) throw new Error("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND kaikki.org") });
      },
    });
    const setup = new Setup(deps);
    await setup.start();
    const dict = setup.status().steps.find((x) => x.id === "dictionary")!;
    assert.deepEqual([dict.state, dict.detail], ["failed", "No internet connection. Connect and try again."]);
    assert.equal(setup.status().ready, false);
    fail = false;
    await setup.start();
    assert.deepEqual(log.filter((l) => l === "names").length, 1, "names aren't downloaded again");
    assert.equal(setup.status().ready, true);
  });

  it("counts translation as done when it's turned off", () => {
    const { deps } = fakeDeps({ namesReady: () => true, dictionaryReady: () => true, model: null });
    assert.equal(new Setup(deps).status().ready, true);
  });

  it("adds the Spanish dictionary and model once a Spanish game is seen", async () => {
    const log: string[] = [];
    let esModel: ProviderStatus = { state: "idle", progress: null, detail: "" };
    const { deps } = fakeDeps({
      namesReady: () => true,
      dictionaryReady: () => true,
      model: null,
      spanish: {
        namesReady: () => false,
        dictionaryReady: () => false,
        importDictionary: async () => void log.push("dictionary-es"),
        model: { status: () => esModel, warmUp: async () => { log.push("model-es"); esModel = { state: "ready", progress: 1, detail: "" }; } },
      },
      importNames: async () => void log.push("names"),
    });
    const setup = new Setup(deps);
    assert.deepEqual(setup.status().steps.map((x) => x.id), ["names", "dictionary", "model"], "German only until then");
    assert.equal(setup.status().ready, true);
    setup.requireSpanish();
    assert.deepEqual(setup.status().steps.map((x) => [x.id, x.state]),
      [["names", "missing"], ["dictionary", "ready"], ["model", "ready"], ["dictionary-es", "missing"], ["model-es", "waiting"]]);
    assert.equal(setup.status().ready, false);
    await setup.start();
    assert.deepEqual(log, ["names", "dictionary-es", "model-es"]);
    assert.equal(setup.status().ready, true);
  });
});
