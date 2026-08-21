/**
 * One bot, locked to one account and failing closed. `allowlist` rather than the shipped `pairing`
 * default, because pairing keeps access in an approval store where a redeploy cannot see it, and
 * this system's single user is a fact about the configuration rather than about a past approval.
 */

import type { Deployment } from "./deployment.ts";
import { secretPaths, secretRef } from "./secrets-store.ts";

export function telegramChannel(deployment: Deployment) {
  return {
    enabled: true,
    apiRoot: deployment.telegramApiRoot,
    botToken: secretRef(secretPaths.telegramBotToken),
    dmPolicy: "allowlist",
    allowFrom: [String(deployment.ownerTelegramUserId)],
    // The four chats are topics in the bot's own private chat, so no group is ever allowed in.
    groupPolicy: "disabled",
    groups: {},
  };
}

export function ownerCommandAllowlist(deployment: Deployment) {
  return { ownerAllowFrom: [`telegram:${deployment.ownerTelegramUserId}`] };
}
