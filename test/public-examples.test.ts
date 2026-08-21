/**
 * A tracked example is a public contract, and a public contract that has drifted from the thing it
 * describes is worse than none. These are the generator's own output, so this holds them to it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, it } from "node:test";
import { exampleDeployment, publicExamples } from "../src/cli/write-public-examples.ts";

describe("the tracked supervision examples", () => {
  for (const [path, contents] of Object.entries(publicExamples(exampleDeployment()))) {
    it(`${basename(path)} is what the generator writes today`, () => {
      assert.equal(
        readFileSync(path, "utf8"),
        contents,
        "run `node src/cli/write-public-examples.ts`.",
      );
    });
  }

  it("names no private root, since every path in it is a placeholder", () => {
    for (const contents of Object.values(publicExamples(exampleDeployment()))) {
      assert.doesNotMatch(contents, /\/Volumes\/|\/Users\//);
    }
  });
});
