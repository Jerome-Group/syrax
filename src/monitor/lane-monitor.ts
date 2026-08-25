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

import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Deployment } from "../adapter/deployment.ts";
import { runtimeLogPath } from "../adapter/runtime-log.ts";
import {
  monitorServerName,
  hatchToolName,
  mcpPath,
  removeRungToolName,
  reportToolName,
  standDownToolName,
  sweepPath,
  watchPath,
} from "../adapter/monitor-tools.ts";
import { ensurePrivateDirectory } from "../adapter/private-state.ts";
import type { Landed } from "../adapter/runtime-command.ts";
import { postUsageReport } from "../surface/usage-report.ts";
import { DailyCounters } from "./counters.ts";
import { EscapeHatch, type HatchAsk } from "./hatch.ts";
import { LaneMembership } from "./lane-membership.ts";
import { mcpEndpoint, type Tool } from "./mcp.ts";
import { RemovalTaps } from "./removal-taps.ts";
import { Removals } from "./removals.ts";
import { sweepChainRungs, type Swept } from "./rung-sweep.ts";
import { RungWatch } from "./rung-watch.ts";
import { type Source, TelemetrySources } from "./sources.ts";
import type { Removed } from "../adapter/removal-ledger.ts";
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

/**
 * A stand down, answered before the lanes have been rebuilt around it: the landing is a promise
 * rather than a fact for the reason the land is deferred at all — it happens after this answer,
 * because this answer is what ends the turn it is waiting for (ADR-0021, and the measurements in
 * `docs/research/landing-an-agents-write.md`). Nothing on the tool path awaits it; what it settles
 * to is posted in System.
 */
export type StoodDown = { standDown: StandDown; landing: Promise<Landed> };

/**
 * A tap, answered. `removed` is null where the value resolved to nothing, which is the one outcome
 * that is not a failure: an expired tap is a report the Owner has kept longer than this process has
 * been up, and the answer is to ask for a fresh one.
 */
export type Removal = {
  removed: Removed | null;
  said: string;
  landing?: Promise<Landed>;
};

export class LaneMonitor {
  readonly counters: DailyCounters;
  readonly telemetry: TelemetrySources;
  readonly hatch: EscapeHatch;
  readonly standDowns: StandDowns;
  readonly rungs: RungWatch;
  readonly removals: Removals;
  #deployment: Deployment;
  #membership: LaneMembership;
  #taps = new RemovalTaps();

  constructor(deployment: Deployment, now: Date = new Date()) {
    ensurePrivateDirectory(deployment.monitorState);
    this.#deployment = deployment;
    this.counters = new DailyCounters(deployment.monitorState, now);
    this.telemetry = new TelemetrySources(this.counters);
    this.hatch = new EscapeHatch(deployment, this.counters, this.telemetry);
    this.standDowns = new StandDowns(deployment.monitorState, now);
    this.#membership = new LaneMembership(deployment);
    this.rungs = new RungWatch(deployment.monitorState, runtimeLogPath(deployment.logsDir));
    this.removals = new Removals(deployment.monitorState);
  }

  /** Each lane's headroom and when the source behind it was last read successfully. */
  sources(now: Date = new Date()): Source[] {
    return this.telemetry.sources(now);
  }

  /** The report, and the file that is its second audience: asking for one always leaves one. */
  report(now: Date = new Date()): UsageReport {
    const report = usageReport(
      this.counters,
      this.telemetry,
      this.standDowns.active(now),
      this.removals.removed(),
      { rotted: this.rungs.rotted(), window: this.rungs.window() },
      now,
    );
    writeUsageReport(this.#deployment.monitorState, report);
    return report;
  }

  /**
   * The unprompted half. A chat surface that cannot be reached loses the message and keeps the
   * file: the report is written before the post is attempted, and a failed post is not allowed to
   * fail the thing that moved.
   *
   * **Every post carries a removal button per rotted rung**, whatever moved. A rung the Owner has
   * not acted on is listed rather than re-announced (ADR-0012), and a listing they cannot act on
   * from where they are reading it is a listing that sends them to the mini with a JSON editor.
   */
  async announce(transition: Transition, now: Date = new Date()): Promise<void> {
    const report = this.report(now);
    try {
      await postUsageReport(
        this.#deployment,
        report,
        transition,
        this.#taps.offer(report.watched.rotted),
      );
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
    if (!this.#membership.differsFrom(this.#absent(now))) return null;
    this.#membership.write();
    const landed = await this.#membership.land();
    if (!landed.landed) {
      console.error(`syrax lane monitor: the lanes were written and not landed: ${landed.said}`);
    }
    return landed;
  }

  /**
   * The rung watch, poked on a schedule rather than run on a turn: it reads the log the runtime
   * writes anyway, and says what moved. Nothing is posted where nothing did.
   */
  async watchRungs(now: Date = new Date()): Promise<Transition[]> {
    const moved = this.rungs.watch(this.#absent(now), now);
    for (const transition of moved) await this.announce(transition, now);
    return moved;
  }

  /**
   * The sweep, which is the half the log cannot do: a chain whose first rung answers every turn
   * says nothing at all about the rungs beneath it, so they are asked. Chain rungs only — the
   * rationed lane is 20 requests a day a rung and observes its own failures beside its counters.
   *
   * It is poked on a schedule for the same reason the watch is, and one more: it spends.
   */
  async sweep(now: Date = new Date()): Promise<{ swept: Swept[]; moved: Transition[] }> {
    const swept = await sweepChainRungs(this.#deployment, this.removals.rungs());
    const moved = this.rungs.swept(swept, now);
    for (const transition of moved) await this.announce(transition, now);
    return { swept, moved };
  }

  /**
   * The tap, and the only thing that removes a rung. The value is resolved by the unit that minted
   * it — a value this process never minted is *expired* and removes nothing, which is what keeps a
   * model from asking for a removal it was never handed (ADR-0012, ADR-0026).
   *
   * Like a stand down it **answers before it has landed**, because this answer is what ends the
   * turn the land is waiting for; what the landing cost arrives in System behind it. A second tap
   * on the same button writes nothing and lands nothing: the rung is already out, and a landing
   * reloads the channel, which is a cost the Owner would be paying for tapping twice.
   */
  removeRung(value: string, now: Date = new Date()): Removal {
    const rung = this.#taps.resolve(value);
    if (rung === undefined) {
      return {
        removed: null,
        said: "that tap is not one this monitor can resolve, so nothing was removed: ask for the report again and tap the button on the message it posts.",
      };
    }
    if (this.removals.holds(rung)) {
      return { removed: null, said: `${rung} is already out of its lane; nothing was written.` };
    }
    const said = this.rungs.rotted().find((one) => one.rung === rung)?.said ?? "it was tapped out";
    const removed = this.removals.remove(
      rung,
      said,
      this.standDowns.active(now).map((held) => held.rung),
      now,
    );
    this.rungs.forget(rung);
    this.#membership.write();
    const landing = this.#landAndSay(
      "a rung removed",
      `${removed.rung} is out of the ${removed.lane} lane for good — the Owner tapped it out, and nothing brings it back but a decision to put it there again.`,
      now,
    );
    return {
      removed,
      said: `${removed.rung} is written out of the ${removed.lane} lane.`,
      landing,
    };
  }

  /** Every rung a chain is composed without: out until a reset, or out for good. */
  #absent(now: Date): string[] {
    return [...this.standDowns.active(now).map((held) => held.rung), ...this.removals.rungs()];
  }

  /**
   * The write, then the land once the turn asking for it is over, and the return scheduled rather
   * than awaited (ADR-0009, ADR-0021). A stand down that writes and stops is a stand down that does
   * not happen; one whose return nothing owns is a rung retired by accident; and one that lands
   * inside its own turn takes the chat down with it, which is the thing the deferral is for.
   *
   * **It answers before it has landed**, on purpose: the answer is what ends the turn the land is
   * waiting for. What the landing did arrives in System behind it.
   */
  standDown(asked: { rung: string; until: Date; why: string }, now: Date = new Date()): StoodDown {
    const standDown = this.standDowns.stand(asked, now, this.removals.rungs());
    this.#membership.write();
    this.#scheduleReturn(standDown);
    const landing = this.#landAndSay(
      "a stand down",
      `${standDown.rung} is out of the ${standDown.lane} lane until ${standDown.until} — ${standDown.why}.`,
      now,
    );
    return { standDown, landing };
  }

  bringBack(rung: string, now: Date = new Date()): StoodDown {
    const standDown = this.standDowns.bringBack(rung);
    this.#membership.write();
    const landing = this.#landAndSay(
      "a stand down returned",
      `${standDown.rung} is back in the ${standDown.lane} lane at the reset it was stood down until.`,
      now,
    );
    return { standDown, landing };
  }

  /**
   * The other half of every membership change, and the only place the Owner hears what it cost:
   * the transition is posted once the lanes are actually rebuilt, so a message saying a rung is out
   * of its lane is never sent while the lane still holds it.
   */
  async #landAndSay(kind: Transition["kind"], said: string, now: Date): Promise<Landed> {
    const landed = await this.#membership.land();
    await this.announce({ kind, said: `${said} ${landed.said}.` }, now);
    return landed;
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
        // The landing is deliberately not awaited and deliberately not returned: this answer is
        // what ends the turn the landing is waiting for, and System gets what it settled to.
        call: (given) => {
          const { standDown } = this.standDown(asStandDown(given));
          return Promise.resolve({
            standDown,
            landing: "the lane is rebuilt once this turn is over; System says what it cost",
          });
        },
      },
      {
        name: removeRungToolName,
        description:
          "Take a rotted rung out of its lane for good. Call it **only** with a value the Owner " +
          "tapped — a message reading `callback_data: <value>` — and never with one you worked " +
          "out or remembered: this is the only thing that removes a rung, and nothing removes, " +
          "replaces or skips one on its own. A value it cannot resolve is expired and removes " +
          "nothing; say so and offer to fetch the report again. Nothing brings a removed rung " +
          "back. Relay what it says.",
        inputSchema: {
          type: "object",
          properties: {
            value: {
              type: "string",
              description: "The tapped `callback_data` value, verbatim.",
            },
          },
          required: ["value"],
        },
        // The landing is neither awaited nor returned, for the reason a stand down's is not: this
        // answer is what ends the turn the landing waits for, and System gets what it settled to.
        call: (given) => {
          const { removed, said } = this.removeRung(String(given.value ?? ""));
          return Promise.resolve({
            removed,
            said,
            ...(removed === null
              ? {}
              : {
                  landing: "the lane is rebuilt once this turn is over; System says what it cost",
                }),
          });
        },
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
        try {
          void this.bringBack(standDown.rung).landing;
        } catch (error) {
          if (error instanceof AlreadyReturned) return;
          console.error(
            `syrax lane monitor: ${standDown.rung} was not written back: ${reason(error)}`,
          );
        }
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

/**
 * Loopback only: the agents are on this machine, and nothing else has business with the hatch.
 * Three paths are served — the MCP endpoint the agents connect to, and the two pokes launchd makes:
 * the rung watch, and the daily sweep. Both are schedules rather than tools because nothing a model
 * does should decide when the runtime's log is read or when Syrax spends a request (ADR-0005).
 */
export async function serveLaneMonitor(
  deployment: Deployment,
): Promise<{ server: Server; port: number; monitor: LaneMonitor }> {
  const monitor = new LaneMonitor(deployment);
  await monitor.reconcile();
  const endpoint = mcpEndpoint(monitorServerName, monitor.tools());
  const server = createServer((request, response) => {
    const path = (request.url ?? "").split("?")[0];
    if (path === watchPath && request.method === "POST") {
      void monitor
        .watchRungs()
        .then((moved) => send(response, 200, { moved }))
        .catch((error: unknown) => send(response, 500, { error: reason(error) }));
      return;
    }
    if (path === sweepPath && request.method === "POST") {
      void monitor
        .sweep()
        .then((sweep) => send(response, 200, sweep))
        .catch((error: unknown) => send(response, 500, { error: reason(error) }));
      return;
    }
    if (path !== mcpPath) {
      send(response, 404, { error: "not found" });
      return;
    }
    void endpoint(request, response);
  });
  await new Promise<void>((resolve) => server.listen(deployment.monitorPort, "127.0.0.1", resolve));
  return { server, port: (server.address() as AddressInfo).port, monitor };
}

function send(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}
