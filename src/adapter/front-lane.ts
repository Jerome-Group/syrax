/**
 * ADR-0016's front chain. Speed chose the shortlist; failure rate chose the order.
 *
 * Every field here is a measurement or a decision, never a default: `maxTokens` is half of the
 * invariant below, and a rung whose ceiling it overruns is a configuration to change before it is
 * a rung to remove.
 */

export type ProviderId = "syrax-gemini" | "syrax-mistral" | "syrax-groq";

export type Rung = {
  provider: ProviderId;
  modelId: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  /** Output the request reserves. A streaming call is charged its prompt plus this (ADR-0016). */
  maxTokens: number;
  /** What the provider refuses a single request over. `null` where it publishes none. */
  perRequestCeilingTokens: number | null;
};

/** The largest single call the front lane makes, measured in #56 and carried by ADR-0009. */
export const frontLaneLargestCallTokens = 6200;

export const frontLane: readonly Rung[] = [
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
];

/** ADR-0016's invariant: a rung's ceiling must exceed its lane's largest call plus its own reservation. */
export function rungFitsItsCeiling(rung: Rung, largestCallTokens: number): boolean {
  return (
    rung.perRequestCeilingTokens === null ||
    largestCallTokens + rung.maxTokens < rung.perRequestCeilingTokens
  );
}

export function modelRef(rung: Rung): string {
  return `${rung.provider}/${rung.modelId}`;
}
