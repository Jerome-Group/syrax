/**
 * What each agent may call, composed per agent rather than inherited.
 *
 * `tools.profile` is `minimal` (ADR-0011), which carries neither the delegation tools nor anything
 * an MCP server serves, so both are named back in. They are named back in *per agent* because a
 * per-agent `alsoAllow` **replaces** the standing one rather than adding to it — measured on
 * `openclaw@2026.6.34`: the two chats that named only their own search tools came back with the
 * three delegation tools gone, which is a front lane that answers everything itself.
 */

import { type Chat, systemChat } from "./chats.ts";
import { hatchTool, removeRungTool, reportTool, standDownTool } from "./monitor-tools.ts";
import { everySearchUnitTool, searchesTheCorpus, searchTool } from "./search-tools.ts";

/** Without these the front lane cannot spawn, and the lane that thinks is unreachable (ADR-0022). */
export const delegationTools = ["sessions_spawn", "sessions_yield", "subagents"];

/**
 * A file and a shortlist are what a search answers with, and neither is expressible as reply text:
 * a document rides a structured media field and a keyboard rides `buttons`. So a chat that searches
 * is a chat that must be able to post one itself.
 */
const messageTool = "message";

/**
 * The hatch is every chat's, being a lane. The report, the stand down and the removal are System's,
 * being Syrax's own state — which is the one domain a chat here owns. The removal is System's for a
 * second reason too: the report that carries its buttons is posted there and nowhere else, so no
 * other chat can be holding a tap to pass back (ADR-0012).
 */
function monitorTools(chat: Chat): string[] {
  return chat.id === systemChat.id
    ? [hatchTool, reportTool, standDownTool, removeRungTool]
    : [hatchTool];
}

export function agentTools(chat: Chat): string[] {
  if (!searchesTheCorpus(chat)) return [...delegationTools, ...monitorTools(chat)];
  return [
    ...delegationTools,
    ...monitorTools(chat),
    ...everySearchUnitTool.map((tool) => searchTool(chat, tool)),
    messageTool,
  ];
}
