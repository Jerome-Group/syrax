/**
 * The retrieval report as the System chat gets it: asked of the resident search unit, and posted
 * only when a number moved or the run failed.
 *
 * The halves are split by what each can reach. The search unit holds the index, the benchmark set
 * and the arithmetic, and writes its report to a file whatever it finds; it holds no bot token and
 * cannot post. This side holds the chat surface and no numbers at all — it states what it was
 * handed and changes nothing, which is the line ADR-0007 draws between reporting and retuning.
 *
 * Exceptions-only is the whole discipline: if neither the index nor the set moved, the numbers are
 * identical, and a message that says the same thing every time trains the Owner to ignore it.
 */

import type { Deployment } from "../adapter/deployment.ts";
import { ChatSurface } from "./chat-surface.ts";

/** The unit's own reply, read in the shape it writes it rather than renamed on the way through. */
export type RetrievalReport = {
  numbers: Record<string, number | null>;
  confident_floor: {
    /** Null only where the run never reached the unit that holds it. */
    pinned: number | null;
    refitted: number | null;
    best_wrong: number | null;
    worst_right: number | null;
    applied: boolean;
  };
  pending_queries: string[];
  failed: string | null;
  moved: string[];
};

export function isWorthPosting(report: RetrievalReport): boolean {
  return report.moved.length > 0 || report.failed !== null;
}

/**
 * Asks the resident unit to score the set. A unit that cannot be reached is a run that failed
 * rather than a command that crashed: the Owner hears about a search unit that is down, which is
 * the more useful half of what this run would have told them.
 */
export async function scoreRetrieval(deployment: Deployment): Promise<RetrievalReport> {
  const endpoint = `http://127.0.0.1:${deployment.searchPort}/benchmark`;
  try {
    const response = await fetch(endpoint, { method: "POST" });
    if (!response.ok) throw new Error(`it answered ${response.status}`);
    return (await response.json()) as RetrievalReport;
  } catch (error) {
    return didNotRun(`the search unit did not score the set: ${reason(error)}`);
  }
}

/** Pokes the unit, and posts the report where it is worth posting. Writing the file is the unit's. */
export async function reportRetrieval(deployment: Deployment): Promise<RetrievalReport> {
  const report = await scoreRetrieval(deployment);
  if (isWorthPosting(report)) {
    await ChatSurface.open(deployment).post("system", retrievalReportLine(report));
  }
  return report;
}

/**
 * The re-fitted floor is stated beside the pinned one and never without the counts: a set that
 * grows by capturing failures becomes a set of hard queries, so the number drifts conservative by
 * construction, and a reader who sees it rise without the counts draws the opposite conclusion.
 */
export function retrievalReportLine(report: RetrievalReport): string {
  if (report.failed !== null) {
    return `Retrieval: the run failed — ${report.failed}. The last numbers stand until one finishes.`;
  }
  const { scored, found, first, fixture, live, pending } = report.numbers;
  return [
    `Retrieval: ${found ?? 0} of ${scored ?? 0} scored queries answered, ${first ?? 0} of them first.`,
    `The confident floor is pinned at ${report.confident_floor.pinned} and ${refit(report)},`,
    `over ${fixture ?? 0} fixture and ${live ?? 0} live entries with ${pending ?? 0} pending.`,
    "Nothing was changed: moving the floor is a pull request.",
    moved(report),
  ]
    .filter((sentence) => sentence !== "")
    .join(" ");
}

function refit(report: RetrievalReport): string {
  const refitted = report.confident_floor.refitted;
  if (refitted === null) return "the set holds nothing to re-fit it against";
  return `would re-fit to ${refitted} against the set as it stands`;
}

function moved(report: RetrievalReport): string {
  if (report.moved.length === 0) return "";
  return `Moved since the last report: ${report.moved.join(", ")}.`;
}

function didNotRun(failed: string): RetrievalReport {
  return {
    numbers: {},
    confident_floor: {
      pinned: null,
      refitted: null,
      best_wrong: null,
      worst_right: null,
      applied: false,
    },
    pending_queries: [],
    failed,
    moved: [],
  };
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
