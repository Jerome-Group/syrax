/**
 * ADR-0016's front chain: the lane that owns the conversation. Speed chose the shortlist; failure
 * rate chose the order.
 *
 * Every field here is a measurement or a decision, never a default: `maxTokens` is half of the
 * invariant in `lane.ts`, and a rung whose ceiling it overruns is a configuration to change before
 * it is a rung to remove.
 */

import type { Lane } from "./lane.ts";

export const frontLane: Lane = {
  name: "front",
  /** Measured in #56 and carried by ADR-0009. */
  largestCallTokens: 6200,
  rungs: [
    {
      provider: "syrax-gemini",
      modelId: "gemini-3.5-flash-lite",
      name: "front-1 Gemini 3.5 Flash Lite",
      reasoning: false,
      contextWindow: 1048576,
      maxTokens: 8192,
      perRequestCeilingTokens: null,
    },
    {
      provider: "syrax-mistral",
      modelId: "ministral-3b-latest",
      name: "front-2 Mistral Ministral 3B",
      reasoning: false,
      contextWindow: 131072,
      maxTokens: 1024,
      perRequestCeilingTokens: null,
    },
    {
      provider: "syrax-groq",
      modelId: "openai/gpt-oss-120b",
      name: "front-3 Groq gpt-oss-120b",
      reasoning: true,
      contextWindow: 131072,
      maxTokens: 1024,
      // Every tool-capable Groq model carries the same 8,000 tokens per minute, and a single
      // request is refused against it.
      perRequestCeilingTokens: 8000,
    },
  ],
};
