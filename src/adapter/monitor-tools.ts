/**
 * The escape hatch as an agent reaches it: one MCP connection to the lane monitor, carried by every
 * chat.
 *
 * Every chat rather than one of them, because the hatch is a **lane** and not a capability. A chat
 * boundary decides which domain's tools are reachable, and the lane a turn is answered on is not a
 * domain — the Owner asking for the hatch in Academic is asking about the question in front of
 * them, and redirecting them to another chat would leave the context behind. What keeps it rare is
 * the hatch's own refusal, not which chat holds it.
 */

import type { Deployment } from "./deployment.ts";
import { hatchServerName, hatchToolName, mcpPath } from "../monitor/lane-monitor.ts";

/** The name a model calls the hatch by: the runtime prefixes the tool with its server. */
export const hatchTool = `${hatchServerName}__${hatchToolName}`;

export function hatchServer(deployment: Deployment) {
  return {
    [hatchServerName]: {
      url: `http://127.0.0.1:${deployment.monitorPort}${mcpPath}`,
      transport: "streamable-http",
    },
  };
}
