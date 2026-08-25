/**
 * The academic desk as an agent reaches it: one MCP connection the Academic chat alone is given,
 * and the loopback path launchd pokes the morning brief on.
 *
 * The desk is a unit of Syrax's rather than a product of its own because neither academic product
 * has a tool layer to lend: both expose a CLI with a versioned `--json` report, and turning one of
 * those into a tool is exactly what refresh-then-read is (#10). What is *not* here is a credential:
 * Syrax runs each product's own command, and the product resolves its own Google and NTULearn
 * access from configuration Syrax never reads.
 */

import type { Deployment } from "./deployment.ts";

export const academicServerName = "syrax-academic";

/** What is due, read off the calendar the product refreshed a moment earlier. */
export const dueToolName = "due";

/** The overnight jobs' verdict, read from the digest ntulearn's watchdog writes. */
export const syncStatusToolName = "sync-status";

/** What arrived overnight, read from the announcements a sync already wrote to disk. */
export const announcementsToolName = "announcements";

/** The folder conformance report, on demand only: nothing schedules one, so nothing reports drift. */
export const auditToolName = "audit";

/** The first of the two writes, and the confirmation it stands behind. */
export const syncToolName = "sync";

/** A private Proposal, which Live never sees: it is the thing a Promotion is confirmed *against*. */
export const proposeToolName = "propose";

/** The second write: the Proposal made real on the Owner's calendar, behind their own tap. */
export const promoteToolName = "promote";

export const mcpPath = "/mcp";

/**
 * Where launchd pokes the morning brief. It is not a tool for the reason the lane monitor's beats
 * are not: what a model must not decide is when the Owner is written to unasked (ADR-0005), and the
 * brief's whole contract is that it arrives on an empty day too.
 */
export const briefPath = "/brief";

export const dueTool = `${academicServerName}__${dueToolName}`;
export const syncStatusTool = `${academicServerName}__${syncStatusToolName}`;
export const announcementsTool = `${academicServerName}__${announcementsToolName}`;
export const auditTool = `${academicServerName}__${auditToolName}`;
export const syncTool = `${academicServerName}__${syncToolName}`;
export const proposeTool = `${academicServerName}__${proposeToolName}`;
export const promoteTool = `${academicServerName}__${promoteToolName}`;

/** Every tool the desk serves, in the order a turn reaches them. */
export const everyAcademicTool = [
  dueTool,
  syncStatusTool,
  announcementsTool,
  auditTool,
  syncTool,
  proposeTool,
  promoteTool,
];

export function academicServer(deployment: Deployment) {
  return {
    [academicServerName]: {
      url: `http://127.0.0.1:${deployment.academicPort}${mcpPath}`,
      transport: "streamable-http",
    },
  };
}
