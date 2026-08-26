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

export function agentDefaults(deployment: Deployment, standingDown: readonly string[]) {
  return {
    model: laneChain(frontLane, standingDown),
    subagents: subagentDefaults(standingDown),
    timeoutSeconds: turnCeilingSeconds,
    // Both catalogues off: the third-party allowlist ADR-0003 emptied, and the runtime's own
    // bundled 31 that ADR-0011 widened it to reach.
    skills: [],
    workspace: deployment.workspace,
    skipBootstrap: true,
    blockStreamingDefault: "off",
    typingMode: "instant",
    heartbeat: heartbeatSettings,
  };
}

/**
 * The runtime pokes every agent on its own cadence whether or not anything says so, and keeps each
 * poke in the session it poked. That is what grows a chat nobody has reset — hundreds of turns the
 * Owner never sent, until the prompt meets a provider's ceiling and the chat *"gets slower and then
 * breaks"*. The poke is a capability worth keeping; retaining it is the defect.
 *
 * The timezone is deliberately not stated. Omitting it falls through `userTimezone`, which Syrax
 * does not state either, to the host clock — the mini's, which is the Owner's. And
 * `src/academic/occurrences.ts` already argues that a second timezone stated anywhere is a second
 * answer to what *today* means.
 */
const heartbeatSettings = {
  // The inherited cadence, restated rather than changed. It has to be here even so: the runtime's
  // schema stops validating `activeHours` altogether when this key is absent, so a mistyped window
  // below would pass `config validate` and then fail open — an unreadable window is read at run
  // time as no window at all, which is a night the heartbeat runs straight through.
  every: "30m",
  // The fix. Each run gets its own session, so a poke no longer appends to the chat the Owner is
  // holding — which is the only reason a chat grew without anybody typing into it.
  isolatedSession: true,
  // Not while the Owner is asleep. The start is the hour the morning brief already treats as the
  // beginning of their day; the end is exclusive, so the last poke lands before eleven.
  activeHours: { start: "07:00", end: "23:00" },
};

/**
 * The worker lane, which is a lane only because it is reached here: the sub-agent override is the
 * one place a chain other than `model` is expressed, so this is what keeps the lane that thinks off
 * the lane that talks — and keeps ADR-0016's promise that no model serves both.
 */
function subagentDefaults(standingDown: readonly string[]) {
  return {
    model: laneChain(workerLane, standingDown),
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
 * The two chains read back out of a written configuration, from the same two keys `agentDefaults`
 * writes them to. It lives here so that moving a chain moves its reader with it: the lane monitor
 * compares what a file holds against what the stand-down ledger implies, and a reader that drifted
 * from the writer would compare nothing and report no difference for ever.
 */
export function chainsIn(config: unknown): { front: unknown; worker: unknown } {
  const defaults = (config as { agents?: { defaults?: Record<string, unknown> } })?.agents
    ?.defaults;
  return {
    front: defaults?.model,
    worker: (defaults?.subagents as { model?: unknown } | undefined)?.model,
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
