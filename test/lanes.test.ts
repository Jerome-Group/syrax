import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { frontLane } from "../src/adapter/front-lane.ts";
import { modelRef, rungFitsItsCeiling } from "../src/adapter/lane.ts";
import { workerLane } from "../src/adapter/worker-lane.ts";

const lanes = [frontLane, workerLane];

describe("the two lanes", () => {
  it("are ADR-0016's compositions, in order", () => {
    assert.deepEqual(frontLane.rungs.map(modelRef), [
      "syrax-gemini/gemini-3.5-flash-lite",
      "syrax-mistral/ministral-3b-latest",
      "syrax-groq/openai/gpt-oss-120b",
    ]);
    assert.deepEqual(workerLane.rungs.map(modelRef), [
      "syrax-gemini/gemini-3.1-flash-lite",
      "syrax-mistral/ministral-8b-latest",
      "syrax-groq/openai/gpt-oss-20b",
      "syrax-zai/glm-4.5-flash",
    ]);
  });

  it("name each provider once per lane, so a chain is not one rung wearing four names", () => {
    for (const lane of lanes) {
      const providers = lane.rungs.map((rung) => rung.provider);
      assert.deepEqual(
        new Set(providers).size,
        providers.length,
        `${lane.name} repeats a provider`,
      );
    }
  });

  it("share no model, so no two lanes stand on one per-model allowance", () => {
    const front = new Set(frontLane.rungs.map(modelRef));
    for (const rung of workerLane.rungs) {
      assert.ok(!front.has(modelRef(rung)), `${modelRef(rung)} serves both lanes`);
    }
  });

  it("let the front lane's second rung finish an ordinary reply, which 1024 could not", () => {
    const rung = frontLane.rungs.find((each) => each.modelId === "ministral-3b-latest");
    assert.ok(rung !== undefined, "the rung #205 measured is no longer on the front lane.");
    assert.ok(
      rung.maxTokens >= 4096,
      `${modelRef(rung)} reserves ${rung.maxTokens}, and #205 measured an ordinary reply running to ~1,700 tokens and cut mid-word at 1024.`,
    );
  });

  it("hold the invariant per rung: its own largest call plus its reservation clears its ceiling", () => {
    for (const lane of lanes) {
      for (const rung of lane.rungs) {
        assert.ok(
          rungFitsItsCeiling(rung),
          `${modelRef(rung)} reserves ${rung.maxTokens} over a ${rung.largestCallTokens}-token call, past its ${rung.perRequestCeilingTokens} ceiling.`,
        );
      }
    }
  });

  it("carry a largest call each, so the figure can be contradicted one rung at a time", () => {
    for (const lane of lanes) {
      for (const rung of lane.rungs) {
        assert.ok(
          Number.isInteger(rung.largestCallTokens) && rung.largestCallTokens > 0,
          `${modelRef(rung)} states no largest call, so nothing can check its ceiling.`,
        );
      }
    }
  });
});
