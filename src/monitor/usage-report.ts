/**
 * The usage report: what each lane has left, and whether its rungs are still there (ADR-0006).
 *
 * It is built here rather than at the chat because the lane monitor is the only place lane state
 * exists — the counters, the stand downs, and when each provider was last understood. The report is
 * the shape that state is read in; the sentence the System chat gets is `src/surface/usage-report.ts`.
 *
 * **A lane's headroom is its own providers' and no others'.** The rationed lane is counted, because
 * its provider reports nothing; the two chain lanes are stated from what their providers said about
 * themselves, and are *unknown* with a timestamp wherever that is nothing (ADR-0006's own rule for
 * a source it cannot read).
 */

import { hatchLane, rungId, silentProvider } from "../adapter/hatch-lane.ts";
import { modelRef, type ProviderId } from "../adapter/lane.ts";
import { chainLanes, providersOf } from "../adapter/lanes.ts";
import { join } from "node:path";
import { writePrivateFile } from "../adapter/private-state.ts";
import type { DailyCounters } from "./counters.ts";
import type { Source, TelemetrySources } from "./sources.ts";
import type { StandDown } from "../adapter/stand-down-ledger.ts";

/** One lane, in the two things a report is asked for: what is left, and what is still in it. */
export type LaneUsage = {
  lane: string;
  /** The rungs a turn would actually reach, in order. */
  serving: string[];
  /**
   * The rung a turn reaches first and the provider its headroom is read from — which is what makes
   * the lane's headroom a lane's rather than a list of providers'. Null where nothing is left.
   */
  answersNext: { rung: string; provider: ProviderId } | null;
  standDowns: StandDown[];
  /** Each provider the lane reaches, with its own telemetry beneath the lane's headline. */
  sources: Source[];
};

export type UsageReport = { at: string; lanes: LaneUsage[] };

/**
 * What makes the report arrive unasked, and the whole of what does: everything else is silence,
 * which is what separates this from a daily brief.
 *
 * Three of the six are stated by the reader of the runtime's own fallback-decision log — a lane
 * switching, and a rung found rotted or found working again (ADR-0012) — which this unit does not
 * hold yet. They are named here because the set is the report's contract rather than a list of
 * today's producers, and a reader meeting a new kind should find it already spelled.
 */
export type Transition = {
  kind:
    | "a stand down"
    | "a stand down returned"
    | "a lane switch"
    | "a rationed spend"
    | "a rotted rung"
    | "a recovered rung";
  said: string;
};

export function usageReport(
  counters: DailyCounters,
  telemetry: TelemetrySources,
  standDowns: readonly StandDown[],
  now: Date = new Date(),
): UsageReport {
  return {
    at: now.toISOString(),
    lanes: [
      ...chainLanes.map((lane) => chainUsage(lane, telemetry, standDowns)),
      hatchUsage(counters, now),
    ],
  };
}

function chainUsage(
  lane: (typeof chainLanes)[number],
  telemetry: TelemetrySources,
  standDowns: readonly StandDown[],
): LaneUsage {
  const out = standDowns.filter((held) => held.lane === lane.name);
  const serving = lane.rungs.filter((rung) => !out.some((held) => held.rung === modelRef(rung)));
  const next = serving[0];
  return {
    lane: lane.name,
    serving: serving.map(modelRef),
    answersNext: next === undefined ? null : { rung: modelRef(next), provider: next.provider },
    standDowns: [...out],
    sources: providersOf(lane).map((provider) => telemetry.reported(provider)),
  };
}

/** Nothing stands down here: the rationed lane is reached rung by rung and sits in no chain. */
function hatchUsage(counters: DailyCounters, now: Date): LaneUsage {
  const next = hatchLane.rungs.find((rung) => counters.remaining(rung, now) > 0);
  return {
    lane: hatchLane.name,
    serving: hatchLane.rungs.map(rungId),
    answersNext: next === undefined ? null : { rung: rungId(next), provider: next.provider },
    standDowns: [],
    sources: [
      {
        provider: silentProvider,
        headroom: { kind: "counted", rungs: counters.state(now) },
        lastReadAt: now.toISOString(),
      },
    ],
  };
}

/** The report's second audience, which is a file: a post the Owner missed is not the only copy. */
export function usageReportPath(monitorState: string): string {
  return join(monitorState, "usage-report.json");
}

export function writeUsageReport(monitorState: string, report: UsageReport): void {
  writePrivateFile(usageReportPath(monitorState), `${JSON.stringify(report, null, 2)}\n`);
}
