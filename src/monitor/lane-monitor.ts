/**
 * The lane monitor: the one place lane state lives (ADR-0006, ADR-0012). It holds the rationed
 * lane's per-rung counters, the count kept for the one provider that reports nothing, and when each
 * source was last read — and it serves the escape hatch over MCP.
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
import { hatchServerName, hatchToolName, mcpPath } from "../adapter/monitor-tools.ts";
import { ensurePrivateDirectory } from "../adapter/private-state.ts";
import { DailyCounters } from "./counters.ts";
import { EscapeHatch, type HatchAsk } from "./hatch.ts";
import { mcpEndpoint, type Tool } from "./mcp.ts";
import { type Source, TelemetrySources } from "./sources.ts";

export class LaneMonitor {
  readonly counters: DailyCounters;
  readonly telemetry: TelemetrySources;
  readonly hatch: EscapeHatch;

  constructor(deployment: Deployment) {
    ensurePrivateDirectory(deployment.monitorState);
    this.counters = new DailyCounters(deployment.monitorState);
    this.telemetry = new TelemetrySources(this.counters);
    this.hatch = new EscapeHatch(deployment, this.counters, this.telemetry);
  }

  /** Each lane's headroom and when the source behind it was last read successfully. */
  sources(now: Date = new Date()): Source[] {
    return this.telemetry.sources(now);
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
        call: (given) => this.hatch.reach(asAsk(given)),
      },
    ];
  }
}

function asAsk(given: Record<string, unknown>): HatchAsk {
  return {
    question: typeof given.question === "string" ? given.question : "",
    askedFor: typeof given.askedFor === "string" ? given.askedFor : "",
  };
}

/** Loopback only: the agents are on this machine, and nothing else has business with the hatch. */
export async function serveLaneMonitor(
  deployment: Deployment,
): Promise<{ server: Server; port: number }> {
  const monitor = new LaneMonitor(deployment);
  const endpoint = mcpEndpoint(hatchServerName, monitor.tools());
  const server = createServer((request, response) => {
    if ((request.url ?? "").split("?")[0] !== mcpPath) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }
    void endpoint(request, response);
  });
  await new Promise<void>((resolve) => server.listen(deployment.monitorPort, "127.0.0.1", resolve));
  return { server, port: (server.address() as AddressInfo).port };
}
