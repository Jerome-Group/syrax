/**
 * When Syrax declares a lane dead. Every number here is stated because the runtime's own defaults
 * for them are either absent or wrong for a chain: a sub-agent run defaults to no timeout at all,
 * which is a delegating turn that hangs until the Owner gives up rather than one that falls to the
 * next rung.
 *
 * Death is declared on two clocks at once. The **idle watchdog** is per provider and measures
 * silence — the runtime aborts a model call that has produced nothing for this long — so it is
 * sized on how long each provider takes to say anything, not on how long it takes to finish. The
 * **whole-turn ceiling** is one number for the turn however many rungs it walks, so a chain that
 * fails slowly cannot outlast the Owner's patience four times over.
 */

import type { ProviderId } from "./lane.ts";

/**
 * Silence a rung is allowed before it is dead. Three of the four answer a terse turn in about a
 * second, so a minute of nothing is a rung that is not coming back; Z.AI is slow by design — 14 s
 * terse, 32.7 s expanded, 73.8 s at p90 (ADR-0016) — and gets a ceiling above its own p90 rather
 * than the same one, which would declare it dead on an ordinary answer.
 */
export const providerIdleTimeoutSeconds: Record<ProviderId, number> = {
  "syrax-gemini": 60,
  "syrax-mistral": 60,
  "syrax-groq": 60,
  "syrax-zai": 180,
};

/**
 * The whole turn, front lane and any worker beneath it. It has to exceed the sub-agent run it may
 * be waiting on — a provider timeout cannot extend the run that contains it — and it is what stops
 * a chain from spending four idle watchdogs in a row.
 */
export const turnCeilingSeconds = 600;

/** A sub-agent run. The runtime's own default is `0`, which is no timeout at all. */
export const subagentRunTimeoutSeconds = 300;

/** Handing a finished worker's result back to the lane that asked for it. */
export const subagentAnnounceTimeoutMs = 120_000;
