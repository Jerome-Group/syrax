/**
 * The lane monitor as an agent reaches it: one MCP connection, and which chat may call what over
 * it.
 *
 * The hatch is carried by **every** chat, because it is a lane and not a capability. A chat
 * boundary decides which domain's tools are reachable, and the lane a turn is answered on is not a
 * domain — the Owner asking for the hatch in Academic is asking about the question in front of
 * them, and redirecting them to another chat would leave the context behind. What keeps it rare is
 * the hatch's own refusal, not which chat holds it.
 *
 * The report, the stand down and the removal are System's alone, and that *is* a domain: System owns
 * Syrax's own state, and either override changes what every other chat is answered on.
 */

import type { Deployment } from "./deployment.ts";

/** The MCP server name the agents' connections carry, and the tools it serves. */
export const monitorServerName = "syrax-monitor";
export const hatchToolName = "reach";
export const reportToolName = "report";
export const standDownToolName = "stand-down";

/** The removal tap's other end. It takes a tapped value and never a rung a model chose. */
export const removeRungToolName = "remove-rung";
export const mcpPath = "/mcp";

/** Where launchd pokes the rung watch. It is not a tool: a schedule decides when a log is read. */
export const watchPath = "/watch";

/**
 * Where launchd pokes the daily sweep. It is not a tool for the reason the watch is not, and for
 * one more: this one spends a request on every chain rung, and what a model may not do is decide
 * when Syrax spends (ADR-0012).
 */
export const sweepPath = "/sweep";

/** The names a model calls them by: the runtime prefixes each tool with its server. */
export const hatchTool = `${monitorServerName}__${hatchToolName}`;
export const reportTool = `${monitorServerName}__${reportToolName}`;
export const standDownTool = `${monitorServerName}__${standDownToolName}`;
export const removeRungTool = `${monitorServerName}__${removeRungToolName}`;

export function monitorServer(deployment: Deployment) {
  return {
    [monitorServerName]: {
      url: `http://127.0.0.1:${deployment.monitorPort}${mcpPath}`,
      transport: "streamable-http",
    },
  };
}
