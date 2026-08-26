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
  rungs: [
    {
      provider: "syrax-gemini",
      modelId: "gemini-3.5-flash-lite",
      name: "front-1 Gemini 3.5 Flash Lite",
      reasoning: false,
      contextWindow: 1048576,
      maxTokens: 8192,
      perRequestCeilingTokens: null,
      // Measured in #56 and carried by ADR-0009, when it was one figure for the whole chain.
      largestCallTokens: 6200,
    },
    {
      provider: "syrax-mistral",
      modelId: "ministral-3b-latest",
      name: "front-2 Mistral Ministral 3B",
      reasoning: false,
      contextWindow: 131072,
      // Mistral bills what it generates rather than what it reserves, so the 1024 this carried
      // saved nothing and cut an ordinary explanatory reply off mid-word. Measured in #205: that
      // reply finishes naturally at ~1,700 tokens, and 4096 rather than 2048 is the room for one
      // longer than ordinary.
      maxTokens: 4096,
      perRequestCeilingTokens: null,
      largestCallTokens: 6200,
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
      // The one rung whose figure anything can contradict, because it is the only one on this lane
      // whose provider refuses a call for its size and says how big it was. #204 watched real
      // traffic pass this and the lane monitor is what says so (ADR-0035).
      largestCallTokens: 6200,
    },
  ],
};
