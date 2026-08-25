/**
 * The retrieval report's unprompted half: what the re-embed pass already wrote, delivered once.
 *
 * The split is `src/surface/retrieval-report.ts`'s, taken one step further. The search unit scores
 * the set on its own three-day pass and writes the report to a file whatever it finds; it holds no
 * bot token and cannot post. This side holds the chat surface and reads that file — it does not
 * score, because a second run would ask a different index a different question and post a number no
 * pass produced. So a beat as often as launchd likes costs one file read, and what reaches System is
 * always what the pass found.
 *
 * **A scoring run is delivered once.** The beat fires hourly and a run lands every third day, so
 * what keeps the report from repeating itself lives here: the stamp of the last run delivered, kept
 * beside the lane monitor's other ledgers and read against the stamp the unit wrote. Exceptions-only
 * decides whether a run is *posted*; this decides whether it is offered a second time.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Deployment } from "../adapter/deployment.ts";
import { writePrivateFile } from "../adapter/private-state.ts";
import {
  isWorthPosting,
  postRetrievalReport,
  scoreRetrieval,
  type RetrievalReport,
} from "../surface/retrieval-report.ts";

/**
 * Where the search unit writes it. The root is the deployment's `searchIndex` and the layout
 * beneath it is the benchmark directory's, mirrored from `SearchConfig.retrieval_report_path` in
 * `search/syrax_search/config.py`: the two units read one deployment file rather than two, so a
 * second key naming this same file would be the drift, not the fix.
 */
export function retrievalReportPath(deployment: Deployment): string {
  return join(deployment.searchIndex, "benchmark", "retrieval-report.json");
}

/** The delivering beat's answer: what it read, whether System heard it, and why not where not. */
export type Delivered = { report: RetrievalReport | null; posted: boolean; said: string };

/**
 * The beat. A machine whose search unit has never scored anything has no file, which is silence
 * rather than a failure: nothing has been measured, so there is nothing the Owner was not told.
 */
export async function deliverScoredRetrieval(
  deployment: Deployment,
  now: Date = new Date(),
): Promise<Delivered> {
  const report = readScoredRetrieval(deployment);
  if (report === null) {
    return { report: null, posted: false, said: "no scoring run has been written to read." };
  }
  return await deliverOnce(deployment, report, now);
}

/** On demand: the set scored now, and the same delivery rule over the run that comes back. */
export async function scoreAndDeliverRetrieval(
  deployment: Deployment,
  now: Date = new Date(),
): Promise<Delivered> {
  return await deliverOnce(deployment, await scoreRetrieval(deployment), now);
}

/**
 * The run is recorded **after** the post rather than before it: a chat surface that could not be
 * reached leaves the run undelivered, and the next beat carries it. A post that went out twice
 * because this process died between the two is the cheaper of the two failures — the other is a
 * moved number nobody is ever told about.
 *
 * A report the unit never scored carries no stamp and is counted against no ledger: it is posted
 * for the ask that produced it, so a real run still waiting to be delivered is not buried under a
 * failure this side invented.
 */
async function deliverOnce(
  deployment: Deployment,
  report: RetrievalReport,
  now: Date,
): Promise<Delivered> {
  const deliveries =
    report.scored_at === "" ? null : new RetrievalDeliveries(deployment.monitorState);
  if (deliveries?.holds(report.scored_at)) {
    return { report, posted: false, said: `the run scored at ${report.scored_at} is delivered.` };
  }
  if (!isWorthPosting(report)) {
    deliveries?.record(report.scored_at, now);
    return {
      report,
      posted: false,
      said: "nothing moved and no run failed, so nothing was posted.",
    };
  }
  await postRetrievalReport(deployment, report);
  deliveries?.record(report.scored_at, now);
  return { report, posted: true, said: `${named(report)} reached System.` };
}

function named(report: RetrievalReport): string {
  return report.scored_at === "" ? "the report" : `the run scored at ${report.scored_at}`;
}

/**
 * The file, read in the shape the unit writes it. A file that is missing, unparseable or naming no
 * run reads as *nothing to deliver*: this side states what it was handed and never reconstructs it,
 * and a half-written report posted as numbers would be worse than a beat that said nothing.
 */
function readScoredRetrieval(deployment: Deployment): RetrievalReport | null {
  const path = retrievalReportPath(deployment);
  if (!existsSync(path)) return null;
  try {
    const report = JSON.parse(readFileSync(path, "utf8")) as RetrievalReport;
    return typeof report?.scored_at === "string" && report.scored_at !== "" ? report : null;
  } catch {
    return null;
  }
}

/** The last run this machine delivered, so the next beat over the same run is a file read. */
class RetrievalDeliveries {
  #path: string;

  constructor(monitorState: string) {
    this.#path = deliveredLedger(monitorState);
  }

  /**
   * A run is delivered once. The stamp itself is matched first, and an older one is held too: a
   * report file restored from a backup is the same run coming round again, and the Owner has
   * already read it.
   */
  holds(scoredAt: string): boolean {
    const last = this.#read();
    if (last === null) return false;
    if (last === scoredAt) return true;
    const [one, other] = [Date.parse(scoredAt), Date.parse(last)];
    return Number.isFinite(one) && Number.isFinite(other) && one <= other;
  }

  record(scoredAt: string, now: Date = new Date()): void {
    writePrivateFile(
      this.#path,
      `${JSON.stringify({ scored_at: scoredAt, delivered_at: now.toISOString() }, null, 2)}\n`,
    );
  }

  /** A ledger that will not parse is read as *nothing delivered*, which errs towards saying it. */
  #read(): string | null {
    if (!existsSync(this.#path)) return null;
    try {
      const held = JSON.parse(readFileSync(this.#path, "utf8")) as { scored_at?: unknown };
      return typeof held?.scored_at === "string" ? held.scored_at : null;
    } catch {
      return null;
    }
  }
}

function deliveredLedger(monitorState: string): string {
  return join(monitorState, "retrieval-delivered.json");
}
