/**
 * What every one of the four agents stands on. Each line is stated rather than inherited, because
 * every default here is wrong for Syrax: the bundled skills catalogue is 53% of a lean turn
 * (ADR-0011), the workspace otherwise lands on the internal disk, and streaming would have been
 * invisible (ADR-0008).
 */

import { join } from "node:path";
import type { Deployment } from "./deployment.ts";
import { defaultChat, everyChat, type Chat } from "./chats.ts";
import { frontLane } from "./front-lane.ts";
import { laneChain } from "./lane.ts";
import {
  subagentAnnounceTimeoutMs,
  subagentRunTimeoutSeconds,
  turnCeilingSeconds,
} from "./timeouts.ts";
import { agentTools } from "./agent-tools.ts";
import { workerLane } from "./worker-lane.ts";

export function agentDefaults(deployment: Deployment) {
  return {
    model: laneChain(frontLane),
    subagents: subagentDefaults(),
    timeoutSeconds: turnCeilingSeconds,
    // Both catalogues off: the third-party allowlist ADR-0003 emptied, and the runtime's own
    // bundled 31 that ADR-0011 widened it to reach.
    skills: [],
    workspace: deployment.workspace,
    skipBootstrap: true,
    blockStreamingDefault: "off",
    typingMode: "instant",
  };
}

/**
 * The worker lane, which is a lane only because it is reached here: the sub-agent override is the
 * one place a chain other than `model` is expressed, so this is what keeps the lane that thinks off
 * the lane that talks — and keeps ADR-0016's promise that no model serves both.
 */
function subagentDefaults() {
  return {
    model: laneChain(workerLane),
    // The front lane stays responsive by delegating anything more involved than a direct reply.
    delegationMode: "prefer",
    // One user, one worker at a time: two concurrent workers would be two calls into one per-model
    // allowance, which is the arrangement ADR-0016 split the lanes to avoid.
    maxConcurrent: 1,
    runTimeoutSeconds: subagentRunTimeoutSeconds,
    announceTimeoutMs: subagentAnnounceTimeoutMs,
  };
}

/**
 * One workspace per agent, under the pinned one. The boundary each agent is told about is project
 * context rather than a channel setting, so the agent carries it wherever it is reached from — the
 * root included, which no topic configuration can name.
 */
export function agentWorkspace(deployment: Deployment, chat: Chat): string {
  return join(deployment.workspace, chat.id);
}

/** One agent per chat, each carrying the tools its chat reaches and no others. */
export function agentList(deployment: Deployment) {
  return everyChat.map((chat) => ({
    id: chat.id,
    workspace: agentWorkspace(deployment, chat),
    ...(chat.id === defaultChat.id ? { default: true } : {}),
    tools: { alsoAllow: agentTools(chat) },
  }));
}
