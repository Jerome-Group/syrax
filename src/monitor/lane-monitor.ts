/**
 * The lane monitor: the one place lane state lives (ADR-0006, ADR-0012). It holds the rationed
 * lane's per-rung counters, which rungs are standing down, and when each source was last read — it
 * writes the usage report from all three, and it serves the escape hatch over MCP.
 *
 * **It sits on no path a reply travels.** Nothing here is called while a turn is being answered
 * except the hatch, and the hatch is reached only because the Owner asked for it by name. That is
 * why it is a unit of its own rather than something inside the gateway: its counters must exist
 * exactly once and must survive a restart of anything else, and an allowance handed back by a
 * restart is an allowance spent twice.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Deployment } from "../adapter/deployment.ts";
import {
  monitorServerName,
  hatchToolName,
  mcpPath,
  reportToolName,
  standDownToolName,
} from "../adapter/monitor-tools.ts";
import { ensurePrivateDirectory } from "../adapter/private-state.ts";
import type { Landed } from "../adapter/runtime-command.ts";
import { postUsageReport } from "../surface/usage-report.ts";
import { DailyCounters } from "./counters.ts";
import { EscapeHatch, type HatchAsk } from "./hatch.ts";
import { LaneMembership } from "./lane-membership.ts";
import { mcpEndpoint, type Tool } from "./mcp.ts";
import { type Source, TelemetrySources } from "./sources.ts";
import type { StandDown } from "../adapter/stand-down-ledger.ts";
import { AlreadyReturned, StandDowns } from "./stand-down.ts";
import {
  type Transition,
  usageReport,
  type UsageReport,
  writeUsageReport,
} from "./usage-report.ts";

/** `setTimeout` counts in a signed 32-bit millisecond, and a reset may be further off than that. */
const longestTimer = 2147483647;

/** A stand down and what became of the write it needs to be one (ADR-0021). */
export type StoodDown = { standDown: StandDown; landed: Landed };

export class LaneMonitor {
  readonly counters: DailyCounters;
  readonly telemetry: TelemetrySources;
  readonly hatch: EscapeHatch;
  readonly standDowns: StandDowns;
  #deployment: Deployment;
  #membership: LaneMembership;

  constructor(deployment: Deployment, now: Date = new Date()) {
    ensurePrivateDirectory(deployment.monitorState);
    this.#deployment = deployment;
    this.counters = new DailyCounters(deployment.monitorState, now);
    this.telemetry = new TelemetrySources(this.counters);
    this.hatch = new EscapeHatch(deployment, this.counters, this.telemetry);
    this.standDowns = new StandDowns(deployment.monitorState, now);
    this.#membership = new LaneMembership(deployment);
  }

  /** Each lane's headroom and when the source behind it was last read successfully. */
  sources(now: Date = new Date()): Source[] {
    return this.telemetry.sources(now);
  }

  /** The report, and the file that is its second audience: asking for one always leaves one. */
  report(now: Date = new Date()): UsageReport {
    const report = usageReport(this.counters, this.telemetry, this.standDowns.active(now), now);
    writeUsageReport(this.#deployment.monitorState, report);
    return report;
  }

  /**
   * The unprompted half. A chat surface that cannot be reached loses the message and keeps the
   * file: the report is written before the post is attempted, and a failed post is not allowed to
   * fail the thing that moved.
   */
  async announce(transition: Transition, now: Date = new Date()): Promise<void> {
    const report = this.report(now);
    try {
      await postUsageReport(this.#deployment, report, transition);
    } catch (error) {
      console.error(`syrax lane monitor: the usage report was not posted: ${reason(error)}`);
    }
  }

  /**
   * Startup: the lanes as the ledger says they stand, written over whatever the configuration says
   * (ADR-0009). A redeploy from the authored contract cannot revert a live stand down, because the
   * contract is not where a stand down is kept — and the returns are re-owned here too, since a
   * reset that arrives while this unit is down has nothing scheduled to write it back.
   */
  async reconcile(now: Date = new Date()): Promise<Landed | null> {
    for (const held of this.standDowns.active(now)) this.#scheduleReturn(held);
    for (const returned of this.standDowns.returnedWhileDown()) {
      await this.announce(
        {
          kind: "a stand down returned",
          said: `${returned.rung} came back to the ${returned.lane} lane: its reset passed while the monitor was down.`,
        },
        now,
      );
    }
    if (!this.#membership.differsFrom(this.standDowns.active(now).map((held) => held.rung))) {
      return null;
    }
    const landed = await this.#membership.write();
    if (!landed.landed) {
      console.error(`syrax lane monitor: the lanes were written and not landed: ${landed.said}`);
    }
    return landed;
  }

  /**
   * The write plus the lander, in that order, and the return scheduled rather than awaited: a
   * stand down that writes and stops is a stand down that does not happen, and one whose return
   * nothing owns is a rung retired by accident (ADR-0009, ADR-0021).
   */
  async standDown(
    asked: { rung: string; until: Date; why: string },
    now: Date = new Date(),
  ): Promise<StoodDown> {
    const standDown = this.standDowns.stand(asked, now);
    const landed = await this.#membership.write();
    this.#scheduleReturn(standDown);
    await this.announce(
      {
        kind: "a stand down",
        said: `${standDown.rung} is out of the ${standDown.lane} lane until ${standDown.until} — ${standDown.why}. ${landed.said}.`,
      },
      now,
    );
    return { standDown, landed };
  }

  async bringBack(rung: string, now: Date = new Date()): Promise<StoodDown> {
    const standDown = this.standDowns.bringBack(rung);
    const landed = await this.#membership.write();
    await this.announce(
      {
        kind: "a stand down returned",
        said: `${standDown.rung} is back in the ${standDown.lane} lane at the reset it was stood down until. ${landed.said}.`,
      },
      now,
    );
    return { standDown, landed };
  }

  tools(): Tool[] {
    return [
      {
        name: hatchToolName,
        description:
          "Reach the escape hatch: one call to the rationed lane, which is a stronger model on a " +
          "20-a-day allowance. Call it **only** when the Owner has asked for it in so many words " +
          "— never on your own judgement that a question is hard. Pass their own words as " +
          "`askedFor`. It refuses, spending nothing, when the day's rungs are gone, and every " +
          "answer states what is left; relay a refusal rather than retrying it.",
        inputSchema: {
          type: "object",
          properties: {
            question: { type: "string", description: "What the Owner wants answered." },
            askedFor: {
              type: "string",
              description: "The Owner's own words asking for the escape hatch, verbatim.",
            },
          },
          required: ["question", "askedFor"],
        },
        call: (given) => this.#reach(asAsk(given)),
      },
      {
        name: reportToolName,
        description:
          "The usage report: what each lane has left, and which rungs are in it. Call it whenever " +
          "the Owner asks how the lanes are doing, or before answering anything about headroom, a " +
          "provider or a rung — never state any of it from memory. A lane whose provider said " +
          "nothing is *unknown* with the time it was last understood, and unknown is not full: " +
          "relay it as unknown.",
        inputSchema: { type: "object", properties: {} },
        call: async () => this.report(),
      },
      {
        name: standDownToolName,
        description:
          "Stand a rung down: take it out of its lane until a stated reset, and write it back " +
          "there when the reset comes. Call it only when the Owner asks for it. `rung` is the " +
          "`provider/model` the report names, `until` is an ISO 8601 timestamp, and `why` is " +
          "their reason in their own words. It refuses a rung no lane holds, a reset already " +
          "past, and a lane's last rung. The gateway restarts safely to land it, which drops the " +
          "sessions; say so.",
        inputSchema: {
          type: "object",
          properties: {
            rung: { type: "string", description: "The rung, as `provider/model`." },
            until: { type: "string", description: "The reset it stands down until, ISO 8601." },
            why: { type: "string", description: "Why it is standing down." },
          },
          required: ["rung", "until", "why"],
        },
        call: (given) => this.standDown(asStandDown(given)),
      },
    ];
  }

  /** A spend is a transition, and it is read off the counters rather than off the answer. */
  async #reach(ask: HatchAsk) {
    const before = this.#spent();
    const answered = await this.hatch.reach(ask);
    if (this.#spent() > before) {
      await this.announce({
        kind: "a rationed spend",
        said: answered.reached
          ? `${answered.rung} answered the escape hatch.`
          : `a rung of the rationed lane was spent and did not answer: ${answered.refused}.`,
      });
    }
    return answered;
  }

  #spent(): number {
    return this.counters.state().reduce((total, rung) => total + rung.spent, 0);
  }

  /**
   * Owned rather than awaited. The timer is unrefed so it never holds this unit up, and the ledger
   * outlives it either way: a reset that passes with nothing running is honoured on the way back in.
   */
  #scheduleReturn(standDown: StandDown): void {
    const due = Date.parse(standDown.until);
    const timer = setTimeout(
      () => {
        if (Date.now() < due) return this.#scheduleReturn(standDown);
        void this.bringBack(standDown.rung).catch((error: unknown) => {
          if (error instanceof AlreadyReturned) return;
          console.error(
            `syrax lane monitor: ${standDown.rung} was not written back: ${reason(error)}`,
          );
        });
      },
      Math.min(Math.max(0, due - Date.now()), longestTimer),
    );
    timer.unref();
  }
}

function asAsk(given: Record<string, unknown>): HatchAsk {
  return {
    question: typeof given.question === "string" ? given.question : "",
    askedFor: typeof given.askedFor === "string" ? given.askedFor : "",
  };
}

/** A reset that will not parse is refused here rather than written as an `Invalid Date`. */
function asStandDown(given: Record<string, unknown>): { rung: string; until: Date; why: string } {
  const until = new Date(String(given.until ?? ""));
  if (Number.isNaN(+until)) {
    throw new Error(`${String(given.until)} is not a reset: pass an ISO 8601 timestamp.`);
  }
  return {
    rung: String(given.rung ?? ""),
    until,
    why: typeof given.why === "string" ? given.why : "",
  };
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Loopback only: the agents are on this machine, and nothing else has business with the hatch. */
export async function serveLaneMonitor(
  deployment: Deployment,
): Promise<{ server: Server; port: number; monitor: LaneMonitor }> {
  const monitor = new LaneMonitor(deployment);
  await monitor.reconcile();
  const endpoint = mcpEndpoint(monitorServerName, monitor.tools());
  const server = createServer((request, response) => {
    if ((request.url ?? "").split("?")[0] !== mcpPath) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }
    void endpoint(request, response);
  });
  await new Promise<void>((resolve) => server.listen(deployment.monitorPort, "127.0.0.1", resolve));
  return { server, port: (server.address() as AddressInfo).port, monitor };
}
