/**
 * What a lane is made of, in the words both lanes are written in. The compositions live one file
 * per lane — `front-lane.ts` and `worker-lane.ts` — because a rung's place in a chain is the
 * decision, and the vocabulary it is stated in is not.
 */

export type ProviderId = "syrax-gemini" | "syrax-mistral" | "syrax-groq" | "syrax-zai";

export type Rung = {
  provider: ProviderId;
  modelId: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  /**
   * Output the request reserves. A call is charged its prompt plus this, whether or not it streams
   * and whether or not the reservation is used (ADR-0016, ADR-0034).
   */
  maxTokens: number;
  /** What the provider refuses a single request over. `null` where it publishes none. */
  perRequestCeilingTokens: number | null;
};

/**
 * A lane: the rungs, in the order they are tried, and the call size their ceilings are measured
 * against. The two travel together everywhere because neither means anything alone — a ceiling
 * without a call size cannot be checked, and a chain without one cannot be composed.
 */
export type Lane = {
  name: "front" | "worker";
  rungs: readonly Rung[];
  /** The largest single call this lane makes, which is the other half of the invariant below. */
  largestCallTokens: number;
};

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

/**
 * A lane as the runtime takes it: the rung that is tried first, then the order it falls through,
 * with any rung standing down left out — a stand down overrides *membership*, and membership is
 * this (ADR-0009).
 *
 * A lane with nothing left in it is refused rather than written: the runtime would take a chain
 * with no primary as a lane that answers nothing, which is the one thing a stand down must not be
 * able to do.
 */
export function laneChain(lane: Lane, standingDown: readonly string[]) {
  const [primary, ...fallbacks] = lane.rungs.filter(
    (rung) => !standingDown.includes(modelRef(rung)),
  );
  if (primary === undefined) {
    throw new Error(
      `the ${lane.name} lane has no rung left: ${standingDown.join(", ")} stand down.`,
    );
  }
  return { primary: modelRef(primary), fallbacks: fallbacks.map(modelRef) };
}
