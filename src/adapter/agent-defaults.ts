/**
 * What every one of the four agents stands on. Each line is stated rather than inherited, because
 * every default here is wrong for Syrax: the bundled skills catalogue is 53% of a lean turn
 * (ADR-0011), the workspace otherwise lands on the internal disk, and streaming would have been
 * invisible (ADR-0008).
 */

import { join } from "node:path";
import type { Deployment } from "./deployment.ts";
import { chats, defaultChatId, type Chat } from "./chats.ts";
import { frontLane, modelRef } from "./front-lane.ts";

export function agentDefaults(deployment: Deployment) {
  const [primary, ...fallbacks] = frontLane;
  return {
    model: {
      primary: modelRef(primary!),
      fallbacks: fallbacks.map(modelRef),
    },
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
 * One workspace per agent, under the pinned one. The boundary each agent is told about is project
 * context rather than a channel setting, so the agent carries it wherever it is reached from — the
 * root included, which no topic configuration can name.
 */
export function agentWorkspace(deployment: Deployment, subject: Chat): string {
  return join(deployment.workspace, subject.id);
}

export function agentList(deployment: Deployment) {
  return chats.map((subject) => ({
    id: subject.id,
    workspace: agentWorkspace(deployment, subject),
    ...(subject.id === defaultChatId ? { default: true } : {}),
  }));
}
