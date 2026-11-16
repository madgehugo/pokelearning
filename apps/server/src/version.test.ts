import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adapterVersionProblem, compareVersions, MIN_ADAPTER_VERSION } from "@pokelearning/shared";

describe("compareVersions", () => {
  it("orders by major, minor, then patch", () => {
    assert.ok(compareVersions("0.1.0", "0.2.0") < 0);
    assert.ok(compareVersions("1.0.0", "0.9.9") > 0);
    assert.ok(compareVersions("0.2.10", "0.2.9") > 0);
    assert.equal(compareVersions("0.2.0", "0.2.0"), 0);
  });

  it("gives NaN for things that aren't versions", () => {
    assert.ok(Number.isNaN(compareVersions("unknown", "0.1.0")));
    assert.ok(Number.isNaN(compareVersions("1.2", "0.1.0")));
  });
});

describe("adapterVersionProblem", () => {
  const min = MIN_ADAPTER_VERSION["mgba-gen3"]!;

  it("accepts the minimum version and newer ones", () => {
    assert.equal(adapterVersionProblem({ adapter: "mgba-gen3", version: min }), null);
    assert.equal(adapterVersionProblem({ adapter: "mgba-gen3", version: "99.0.0" }), null);
  });

  it("doesn't check adapters it has no minimum for", () => {
    assert.equal(adapterVersionProblem({ adapter: "someone-elses", version: "unknown" }), null);
  });

  it("says what to do when the script is too old or says nothing", () => {
    MIN_ADAPTER_VERSION["mgba-gen3"] = "0.5.0";
    try {
      assert.match(adapterVersionProblem({ adapter: "mgba-gen3", version: "0.4.9" })!, /version 0\.4\.9.*0\.5\.0/);
      assert.match(adapterVersionProblem({ adapter: "mgba-gen3", version: "unknown" })!, /unknown version/);
    } finally {
      MIN_ADAPTER_VERSION["mgba-gen3"] = min;
    }
  });
});
