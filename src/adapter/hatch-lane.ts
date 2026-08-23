/**
 * The rationed lane: the Gemini Flash rows, each answering from its own 20-a-day bucket. Nothing in
 * the runtime walks this chain — the lane monitor's hatch tool reaches a rung directly, and a rung
 * named here is deliberately absent from `front-lane.ts` and `worker-lane.ts` (ADR-0006).
 *
 * The composition is the version ladder as it was last measured answering from separate buckets.
 * `gemini-flash-latest` and the `-preview` suffixes of a version already here are aliases: they
 * share the bucket of the row they name, so adding one buys a counter and no allowance. A row joins
 * this list only once it has been saturated and its neighbour probed — which is what told the two
 * Flash Lite rows apart from the four names that turned out to be one of them.
 */

export type RationedRung = {
  provider: "syrax-gemini";
  modelId: string;
  name: string;
  /** Requests a day, which is the whole of this row's allowance: Gemini's free tier meters by RPD. */
  dailyRequests: number;
};

export const hatchLane = {
  name: "hatch",
  rungs: [
    {
      provider: "syrax-gemini",
      modelId: "gemini-3.7-flash",
      name: "hatch-1 Gemini 3.7 Flash",
      dailyRequests: 20,
    },
    {
      provider: "syrax-gemini",
      modelId: "gemini-3.6-flash",
      name: "hatch-2 Gemini 3.6 Flash",
      dailyRequests: 20,
    },
    {
      provider: "syrax-gemini",
      modelId: "gemini-3-flash-preview",
      name: "hatch-3 Gemini 3 Flash preview",
      dailyRequests: 20,
    },
  ],
} as const satisfies { name: string; rungs: readonly RationedRung[] };

/** How a rung is named wherever it is counted, logged or reported. */
export function rungId(rung: RationedRung): string {
  return `${rung.provider}/${rung.modelId}`;
}

/** The provider that reports nothing at all, so its allowance is the one Syrax counts (ADR-0009). */
export const silentProvider = "syrax-gemini";
