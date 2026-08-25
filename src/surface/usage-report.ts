/**
 * The usage report as the System chat gets it: one message, and only when something moved.
 *
 * Posting takes a transition rather than deciding whether there was one, which is the discipline in
 * the type — a report is asked for at any time and arrives unasked only behind a stand down, a lane
 * switch, a rationed spend or a rung found rotted or working again. A message that says the same
 * thing every time trains the Owner to ignore it, and this is the one they must not.
 */

import type { Deployment } from "../adapter/deployment.ts";
import type { Headroom, Source } from "../monitor/sources.ts";
import type { LaneUsage, Transition, UsageReport } from "../monitor/usage-report.ts";
import type { Button } from "./bot-api.ts";
import { ChatSurface } from "./chat-surface.ts";

/**
 * The buttons are passed in rather than derived from the report, because what a tap has to resolve
 * back to is held by the unit that minted it and not by the message it rides on (ADR-0012).
 */
export async function postUsageReport(
  deployment: Deployment,
  report: UsageReport,
  transition: Transition,
  buttons: readonly Button[] = [],
): Promise<void> {
  await ChatSurface.open(deployment).post("system", usageReportLine(report, transition), buttons);
}

export function usageReportLine(report: UsageReport, transition?: Transition): string {
  const opening =
    transition === undefined
      ? `Usage at ${report.at}.`
      : `Usage — ${transition.kind}: ${transition.said}`;
  return [opening, ...report.lanes.map(laneLines), ...watched(report.watched)].join("\n\n");
}

/**
 * The rotted rungs are listed rather than re-announced — a post repeating a condition nobody has
 * acted on is the thing this report is defined not to be — and the window is stated only where it
 * has a gap in it, because a reader who is told the window every time stops reading it.
 */
function watched(seen: UsageReport["watched"]): string[] {
  const lines = [
    ...seen.rotted.map(
      (one) =>
        `- ${one.rung} (${one.lane}) has answered to no such name since ${one.at}: "${one.said}"`,
    ),
    ...(seen.window?.unknown === undefined || seen.window.unknown === null
      ? []
      : [`- the rung watch did not cover everything: ${seen.window.unknown}`]),
  ];
  return lines.length === 0 ? [] : [["**rungs**", ...lines].join("\n")];
}

function laneLines(usage: LaneUsage): string {
  return [`**${usage.lane}** — ${headline(usage)}`, ...usage.sources.map(sourceLine)].join("\n");
}

/**
 * The lane's own headroom, which is the question behind the report: can it still talk, and can it
 * still think. It is the rung a turn reaches first and what that rung's provider has left — a list
 * of providers is the working underneath, and reading a lane's state off it is the reader's job
 * this line exists to do for them.
 */
function headline(usage: LaneUsage): string {
  const next = usage.answersNext;
  if (next === null) return `nothing left to answer on. ${membership(usage)}`;
  const source = usage.sources.find((one) => one.provider === next.provider);
  const left =
    source === undefined ? "unknown — no source stands behind it" : laneHeadroom(source.headroom);
  return `${next.rung} answers next, with ${left}. ${membership(usage)}`;
}

/**
 * A counted lane's headroom is its day, not its rungs: the per-rung counts are stated beneath, and
 * a headline that repeated them would bury the one number the Owner is asking for.
 */
function laneHeadroom(left: Headroom): string {
  if (left.kind !== "counted") return headroom(left);
  const remaining = left.rungs.reduce((total, rung) => total + rung.remaining, 0);
  const allowance = left.rungs.reduce((total, rung) => total + rung.allowance, 0);
  return `${remaining} of ${allowance} calls left today`;
}

/**
 * A removed rung is stated beside the stand downs and never as one: the two read alike and are
 * opposites underneath, since a stand down is written back at its reset and a removal is the Owner
 * saying there is nothing to come back.
 */
function membership(usage: LaneUsage): string {
  const out = usage.standDowns.map((held) => `${held.rung} until ${held.until} (${held.why})`);
  const gone = usage.removed.map((held) => `${held.rung}, removed ${held.at}`);
  const lines = [
    ...(out.length === 0 ? [] : [`standing down: ${out.join("; ")}`]),
    ...(gone.length === 0 ? [] : [`taken out for good: ${gone.join("; ")}`]),
  ];
  if (lines.length === 0) return `${usage.serving.length} rungs, none standing down.`;
  return `${usage.serving.length} rungs serving; ${lines.join("; ")}.`;
}

function sourceLine(source: Source): string {
  return `- ${source.provider}: ${headroom(source.headroom)} ${lastRead(source)}`;
}

function lastRead(source: Source): string {
  return source.lastReadAt === null ? "(never read)" : `(read ${source.lastReadAt})`;
}

/**
 * *unknown* is stated as plainly as a number is. A report that reads an absence as headroom is
 * worse than one that admits it cannot see, and the timestamp beside it is what tells a quiet day
 * from a source that stopped being understood.
 */
function headroom(left: Headroom): string {
  if (left.kind === "unknown") return `unknown — ${left.why}`;
  if (left.kind === "counted") {
    const rungs = left.rungs
      .map((rung) => `${rung.remaining} of ${rung.allowance} on ${rung.rung}`)
      .join(", ");
    return `${rungs}${lastRefusal(left)}`;
  }
  return [left.rungs.requests, left.rungs.tokens]
    .filter((rung) => rung !== undefined)
    .map((rung) => `${rung.remaining} of ${rung.limit} a ${rung.window}`)
    .join(", ");
}

/** What refused a rung last, in the provider's own words: the *can it still think* half. */
function lastRefusal(counted: Extract<Headroom, { kind: "counted" }>): string {
  const refused = counted.rungs
    .map((rung) => rung.refused)
    .filter((refusal) => refusal !== undefined)
    .sort((one, other) => one.at.localeCompare(other.at))
    .at(-1);
  return refused === undefined ? "" : `; last refused at ${refused.at}: ${refused.said}`;
}
