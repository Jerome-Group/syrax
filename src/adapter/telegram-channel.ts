/**
 * One bot, locked to one account and failing closed. `allowlist` rather than the shipped `pairing`
 * default, because pairing keeps access in an approval store where a redeploy cannot see it, and
 * this system's single user is a fact about the configuration rather than about a past approval.
 */

import type { CarrierMap } from "./carriers.ts";
import { everyChat } from "./chats.ts";
import type { Deployment } from "./deployment.ts";
import { secretPaths, secretRef } from "./secrets-store.ts";

/** The one channel there is, named where it is configured: a reload is addressed to it by name. */
export const channelName = "telegram";

export function telegramChannel(deployment: Deployment, carriers: CarrierMap) {
  return {
    enabled: true,
    apiRoot: deployment.telegramApiRoot,
    botToken: secretRef(secretPaths.telegramBotToken),
    streaming: progressDraft(),
    dmPolicy: "allowlist",
    allowFrom: [String(deployment.ownerTelegramUserId)],
    // The four chats are topics in the bot's own private chat, so no group is ever allowed in.
    groupPolicy: "disabled",
    groups: {},
    // The Owner's private chat with the bot, whose id is the Owner's own. `requireTopic` is left
    // unset throughout: setting it drops a root message silently rather than answering it as
    // General, which is the one setting that breaks this arrangement.
    direct: {
      [String(deployment.ownerTelegramUserId)]: { topics: topicRouting(carriers) },
    },
  };
}

/**
 * The one message a slow turn is allowed to post. ADR-0008 leaves the answer unstreamed, so what
 * fills a long turn is a status draft rather than the answer arriving in pieces: one message, sent
 * once the turn has proved it is working, edited as the work proceeds.
 */
function progressDraft() {
  return {
    mode: "progress",
    progress: {
      // Stated rather than drawn from the runtime's pool of twenty, which would name the same work
      // differently on every turn.
      label: "Working",
      toolProgress: true,
      // What the Owner is told is that work is happening, never what the work is looking at.
      commandText: "status",
      maxLines: 4,
    },
  };
}

/**
 * `agentId` is topic-only and inherits from nothing, so a carrier the map does not name routes to
 * the default agent — which is General answering a chat it does not own until the write path
 * recreates the carrier and this map is written again.
 */
function topicRouting(carriers: CarrierMap): Record<string, { agentId: string }> {
  const routed = everyChat
    .filter((chat) => carriers[chat.id] !== undefined)
    .map((chat) => [String(carriers[chat.id]), { agentId: chat.id }] as const);
  return Object.fromEntries(routed);
}

export function ownerCommandAllowlist(deployment: Deployment) {
  return { ownerAllowFrom: [`telegram:${deployment.ownerTelegramUserId}`] };
}
