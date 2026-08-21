/**
 * The runtime adapter: Syrax's decisions as one OpenClaw configuration. It is a contract expressed
 * in configuration rather than a layer of code standing in front of the runtime (ADR-0003), so this
 * builds a file and nothing here ever sits on a request path.
 */

import type { Deployment } from "./deployment.ts";
import { agentDefaults, agentList } from "./general-agent.ts";
import { providerBlocks } from "./providers.ts";
import { secretsProviderBlock, secretPaths, secretRef } from "./secrets-store.ts";
import { ownerCommandAllowlist, telegramChannel } from "./telegram-channel.ts";

export function buildRuntimeConfig(deployment: Deployment) {
  return {
    models: {
      mode: "merge",
      providers: providerBlocks(deployment),
    },
    agents: {
      defaults: agentDefaults(deployment),
      list: agentList(),
    },
    // ADR-0011's fourth standing line. The prompt the front lane pays for is a property of this.
    tools: { profile: "minimal" },
    channels: { telegram: telegramChannel(deployment) },
    commands: ownerCommandAllowlist(deployment),
    gateway: {
      mode: "local",
      auth: { mode: "token", token: secretRef(secretPaths.gatewayAuthToken) },
    },
    secrets: { providers: secretsProviderBlock(deployment.secretsStore) },
  };
}
