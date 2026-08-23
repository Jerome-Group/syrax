/**
 * Writes the generated runtime configuration and each agent's workspace beside it, refusing before
 * it writes rather than leaving a gateway that comes up and fails every turn (ADR-0019). The write
 * path runs it again wherever a carrier is recreated, so the new carrier routes to its own agent.
 */

import { dirname, join, relative, resolve } from "node:path";
import { agentWorkspace } from "./agent-defaults.ts";
import { buildRuntimeConfig } from "./build.ts";
import type { CarrierMap } from "./carriers.ts";
import { everyChat } from "./chats.ts";
import { chatInstruction } from "./instruction.ts";
import type { Deployment } from "./deployment.ts";
import { ensurePrivateDirectory, writePrivateFile } from "./private-state.ts";
import { unconfiguredScopes } from "./search-tools.ts";
import { assertSecretsStoreIsPrivate } from "./secrets-store.ts";

const checkout = resolve(import.meta.dirname, "..", "..");

/** Placement is the control, not the ignore rule: a root inside the checkout is committable. */
function assertOutsideCheckout(deployment: Deployment): void {
  for (const [key, value] of Object.entries(deployment)) {
    if (typeof value !== "string" || !value.startsWith("/")) continue;
    const inside = relative(checkout, value);
    if (!inside.startsWith("..")) {
      throw new Error(`${key} is inside the checkout (${value}); private roots live outside it.`);
    }
  }
}

/**
 * A scope the search unit was never given a root for is refused at the first query of the chat that
 * carries it, which is a chat answering nothing and saying why nowhere.
 */
function assertEveryScopeIsConfigured(deployment: Deployment): void {
  const missing = unconfiguredScopes(deployment);
  if (missing.length > 0) {
    throw new Error(
      `searchScopes names no root for ${missing.join(", ")}, so that chat would search nothing. ` +
        `Add it as "searchScopes": { "${missing[0]}": "/an/absolute/root" } in the deployment.`,
    );
  }
}

export function generateConfig(deployment: Deployment, carriers: CarrierMap): void {
  assertOutsideCheckout(deployment);
  assertEveryScopeIsConfigured(deployment);
  assertSecretsStoreIsPrivate(deployment.secretsStore);

  for (const directory of [
    deployment.workspace,
    ...everyChat.map((chat) => agentWorkspace(deployment, chat)),
    deployment.stateDir,
    deployment.logsDir,
    dirname(deployment.configPath),
  ]) {
    ensurePrivateDirectory(directory);
  }

  for (const chat of everyChat) {
    writePrivateFile(join(agentWorkspace(deployment, chat), "AGENTS.md"), chatInstruction(chat));
  }
  // The generated file names the Owner's Telegram account, the secrets store and every private
  // root. It is private runtime state by this repository's own definition, so it is written like it.
  writePrivateFile(
    deployment.configPath,
    `${JSON.stringify(buildRuntimeConfig(deployment, carriers), null, 2)}\n`,
  );
}
