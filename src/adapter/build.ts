/**
 * The runtime adapter: Syrax's decisions as one OpenClaw configuration. It is a contract expressed
 * in configuration rather than a layer of code standing in front of the runtime (ADR-0003), so this
 * builds a file and nothing here ever sits on a request path.
 */

import { agentDefaults, agentList } from "./agent-defaults.ts";
import type { CarrierMap } from "./carriers.ts";
import type { Deployment } from "./deployment.ts";
import { loggingBlock } from "./runtime-log.ts";
import { providerBlocks } from "./providers.ts";
import { secretsProviderBlock, secretPaths, secretRef } from "./secrets-store.ts";
import { ownerCommandAllowlist, telegramChannel } from "./telegram-channel.ts";

export function buildRuntimeConfig(deployment: Deployment, carriers: CarrierMap) {
  return {
    models: {
      mode: "merge",
      providers: providerBlocks(deployment),
    },
    agents: {
      defaults: agentDefaults(deployment),
      list: agentList(deployment),
    },
    // ADR-0011's fourth standing line. The prompt the front lane pays for is a property of this.
    // The three delegation tools are named back in because `minimal` does not carry them, and a
    // front lane that cannot spawn is a front lane that answers everything itself.
    tools: {
      profile: "minimal",
      alsoAllow: ["sessions_spawn", "sessions_yield", "subagents"],
    },
    channels: { telegram: telegramChannel(deployment, carriers) },
    commands: ownerCommandAllowlist(deployment),
    gateway: {
      mode: "local",
      port: deployment.gatewayPort,
      auth: { mode: "token", token: secretRef(secretPaths.gatewayAuthToken) },
    },
    secrets: { providers: secretsProviderBlock(deployment.secretsStore) },
    logging: loggingBlock(deployment.logsDir),
  };
}
