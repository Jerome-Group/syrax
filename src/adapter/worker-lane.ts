/**
 * ADR-0016's worker chain: the lane that thinks, reached only through the sub-agent override so
 * that no model serves both lanes and no two lanes share a quota bucket.
 *
 * The reservations are larger than the front lane's because this is the lane that writes the
 * answer, and they are what makes Groq a rung at all: ADR-0009 read four `413`s at 13,200–13,431
 * tokens as a property of the provider, and ADR-0016 corrected them to a prompt plus the 8,192 the
 * request reserved. What the ceiling is measured against is the prompt.
 */

import type { Lane } from "./lane.ts";

export const workerLane: Lane = {
  name: "worker",
  rungs: [
    {
      provider: "syrax-gemini",
      modelId: "gemini-3.1-flash-lite",
      name: "worker-1 Gemini 3.1 Flash Lite",
      reasoning: false,
      contextWindow: 1048576,
      maxTokens: 8192,
      perRequestCeilingTokens: null,
      largestCallTokens: 5239,
    },
    {
      provider: "syrax-mistral",
      modelId: "ministral-8b-latest",
      name: "worker-2 Mistral Ministral 8B",
      reasoning: false,
      contextWindow: 262144,
      maxTokens: 8192,
      perRequestCeilingTokens: null,
      largestCallTokens: 5239,
    },
    {
      provider: "syrax-groq",
      modelId: "openai/gpt-oss-20b",
      name: "worker-3 Groq gpt-oss-20b",
      reasoning: true,
      contextWindow: 131072,
      // The one reservation on either lane that is chosen by arithmetic rather than by appetite:
      // the largest power of two the worker's own call leaves under Groq's 8,000-token ceiling.
      maxTokens: 2048,
      perRequestCeilingTokens: 8000,
      /**
       * ADR-0009's largest refused request (13,431) less the 8,192 that request reserved. This is
       * the rung that refusal came from, and the figure belongs to it rather than to the lane: a
       * sub-agent's first call is larger than the front-lane turn that spawned it, because it
       * carries its own tool schemas and the schemas dominate.
       */
      largestCallTokens: 5239,
    },
    {
      provider: "syrax-zai",
      modelId: "glm-4.5-flash",
      // The floor, and genuinely a floor: it answers a terse turn in 14 s where the rung above it
      // answers in one, and it is here because it publishes no token or daily ceiling at all.
      name: "worker-4 Z.AI GLM-4.5-Flash",
      reasoning: false,
      contextWindow: 128000,
      // It spends reservation on reasoning it emits whether or not it is asked to, so it keeps the
      // full one: a 16-token allowance came back as thinking and no content.
      maxTokens: 8192,
      perRequestCeilingTokens: null,
      largestCallTokens: 5239,
    },
  ],
};
