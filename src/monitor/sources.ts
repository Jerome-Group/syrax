/**
 * Where each lane's headroom comes from, and when that source was last read successfully.
 *
 * The providers do not answer the same question, so neither does this: **the provider is the
 * authority wherever it speaks**, and a local count stands in only for the one provider that says
 * nothing at all. A counted number is never offered for a provider that reports — a count of the
 * calls Syrax knows about would read as the provider's remaining allowance while missing every
 * call the runtime made, which is most of them.
 *
 * The timestamp is the load-bearing part (ADR-0006). Header names, and the runtime state they are
 * observed through, are internal surfaces outside anybody's contract; when one changes shape the
 * source goes *unknown* and says when it was last understood, because a stale number and a quiet
 * day are otherwise the same reading.
 */

import type { ProviderId } from "../adapter/lane.ts";
import { silentProvider } from "../adapter/hatch-lane.ts";
import type { DailyCounters, Spent } from "./counters.ts";
import {
  type HeaderSource,
  readReported,
  type Reported,
  reportsItsOwnTelemetry,
} from "./telemetry.ts";

export type Headroom =
  /** What the provider itself last said, in its own rungs. */
  | { kind: "reported"; rungs: Reported }
  /** What Syrax has spent of a rationed allowance the provider never reports. */
  | { kind: "counted"; rungs: Spent[] }
  | { kind: "unknown"; why: string };

export type Source = {
  provider: ProviderId;
  headroom: Headroom;
  /** When this source was last read *successfully*. Null where it never has been. */
  lastReadAt: string | null;
};

export const everyProvider: readonly ProviderId[] = [
  "syrax-gemini",
  "syrax-mistral",
  "syrax-groq",
  "syrax-zai",
];

type Observed = { rungs: Reported; at: string };

export class TelemetrySources {
  #counters: DailyCounters;
  #observed = new Map<ProviderId, Observed>();
  #stoppedParsing = new Set<ProviderId>();

  constructor(counters: DailyCounters) {
    this.#counters = counters;
  }

  /**
   * A response from a provider, read for what it says about itself. A provider that reported before
   * and does not now has *stopped parsing* — its last numbers are not offered again, because the
   * thing that would make them wrong is exactly the thing that stopped them being readable.
   */
  observe(provider: ProviderId, headers: HeaderSource, at: Date = new Date()): void {
    if (!reportsItsOwnTelemetry(provider)) return;
    const rungs = readReported(provider, headers);
    if (rungs === null) {
      this.#stoppedParsing.add(provider);
      return;
    }
    this.#stoppedParsing.delete(provider);
    this.#observed.set(provider, { rungs, at: at.toISOString() });
  }

  sources(now: Date = new Date()): Source[] {
    return everyProvider.map((provider) => this.#source(provider, now));
  }

  #source(provider: ProviderId, now: Date): Source {
    if (provider === silentProvider) {
      // Read in this process, off counters this unit owns, so it is current by construction — and
      // it is the only source here of which that is true.
      return {
        provider,
        headroom: { kind: "counted", rungs: this.#counters.state(now) },
        lastReadAt: now.toISOString(),
      };
    }
    return this.reported(provider);
  }

  /**
   * What a provider says about itself, with no local count standing in for it. It is what a lane
   * the counters know nothing about is reported from: the rationed lane's counts are the rationed
   * lane's, and reading them as the front lane's headroom would state a number about the wrong
   * allowance entirely.
   */
  reported(provider: ProviderId): Source {
    if (!reportsItsOwnTelemetry(provider)) {
      return {
        provider,
        headroom: { kind: "unknown", why: "it publishes no allowance and reports none" },
        lastReadAt: null,
      };
    }
    const observed = this.#observed.get(provider);
    if (observed === undefined) {
      return {
        provider,
        headroom: { kind: "unknown", why: "nothing has been read from it yet" },
        lastReadAt: null,
      };
    }
    if (this.#stoppedParsing.has(provider)) {
      return {
        provider,
        headroom: { kind: "unknown", why: "its telemetry stopped parsing" },
        lastReadAt: observed.at,
      };
    }
    return {
      provider,
      headroom: { kind: "reported", rungs: observed.rungs },
      lastReadAt: observed.at,
    };
  }
}
