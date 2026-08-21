import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  frontLane,
  frontLaneLargestCallTokens,
  modelRef,
  rungFitsItsCeiling,
} from "../src/adapter/front-lane.ts";

describe("the front lane", () => {
  it("is ADR-0016's composition, in order", () => {
    assert.deepEqual(frontLane.map(modelRef), [
      "syrax-gemini/gemini-3.5-flash-lite",
      "syrax-mistral/ministral-3b-latest",
      "syrax-groq/openai/gpt-oss-120b",
    ]);
  });

  it("names each provider once, so a chain is not one rung wearing three names", () => {
    const providers = frontLane.map((rung) => rung.provider);
    assert.equal(new Set(providers).size, providers.length);
  });

  it("holds ADR-0016's invariant: the largest call plus the reservation clears every ceiling", () => {
    for (const rung of frontLane) {
      assert.ok(
        rungFitsItsCeiling(rung, frontLaneLargestCallTokens),
        `${modelRef(rung)} reserves ${rung.maxTokens} over a ${frontLaneLargestCallTokens}-token call, past its ${rung.perRequestCeilingTokens} ceiling.`,
      );
    }
  });
});
