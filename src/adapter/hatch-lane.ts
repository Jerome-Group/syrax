/**
 * The rationed lane: the Gemini Flash rows, each answering from its own 20-a-day bucket. Nothing in
 * the runtime walks this chain — the lane monitor's hatch tool reaches a rung directly, and a rung
 * named here is deliberately absent from `front-lane.ts` and `worker-lane.ts` (ADR-0006).
 *
 * **The ladder is four rows, and it was five names** (ADR-0029). `gemini-flash-latest` is an alias,
 * refusing in the same minute bucket as `gemini-3.7-flash` while the other rows answered, and
 * `gemini-2.5-flash` is in the catalogue and 404s. So a row joins this list only once it has
 * answered and its neighbours have been probed in the same minute: a name is not an allowance, and
 * a catalogue is not an entitlement.
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
      modelId: "gemini-3.5-flash",
      name: "hatch-3 Gemini 3.5 Flash",
      dailyRequests: 20,
    },
    {
      provider: "syrax-gemini",
      modelId: "gemini-3-flash-preview",
      name: "hatch-4 Gemini 3 Flash preview",
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
