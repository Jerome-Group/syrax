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
   * Output the request reserves. On Groq a call is charged its prompt plus this, whether or not it
   * streams and whether or not the reservation is used (ADR-0016, ADR-0034). A provider that bills
   * what it generates charges nothing for the headroom, which is why the two differ per rung.
   */
  maxTokens: number;
  /** What the provider refuses a single request over. `null` where it publishes none. */
  perRequestCeilingTokens: number | null;
  /**
   * The largest call this rung is asked to take, which is the other half of the invariant below.
   * It sits on the rung rather than on the lane because a ceiling is the provider's and a call is
   * what reaches that provider: one figure for a whole chain cannot say that a rung two positions
   * down is asked something a different size, and cannot be contradicted rung by rung when real
   * traffic outgrows it (ADR-0035).
   */
  largestCallTokens: number;
};

/** A lane: the rungs, in the order they are tried. */
export type Lane = {
  name: "front" | "worker";
  rungs: readonly Rung[];
};

/**
 * ADR-0016's invariant, now read per rung (ADR-0035): a rung's ceiling must exceed the largest call
 * it is asked to take plus its own reservation. Both terms are the rung's, which is what lets one
 * chain hold rungs on opposite sides of the same arithmetic.
 */
export function rungFitsItsCeiling(rung: Rung): boolean {
  return (
    rung.perRequestCeilingTokens === null ||
    rung.largestCallTokens + rung.maxTokens < rung.perRequestCeilingTokens
  );
}

/**
 * What a refusal says the call actually was. A provider that refuses a request for its size names
 * the total it charged — prompt plus reservation (ADR-0034) — so the call is that total less what
 * this rung reserves, and it is the only observation of a real call size anything here can make:
 * a served call says nothing about its own size anywhere in the runtime's log.
 */
export function callBehind(rung: Rung, requestedTokens: number): number {
  return requestedTokens - rung.maxTokens;
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
