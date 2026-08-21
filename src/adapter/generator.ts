/**
 * Writes the generated runtime configuration and each agent's workspace beside it, refusing before
 * it writes rather than leaving a gateway that comes up and fails every turn (ADR-0019). The write
 * path runs it again wherever a carrier is recreated, so the new carrier routes to its own agent.
 */

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { agentWorkspace } from "./agent-defaults.ts";
import { buildRuntimeConfig } from "./build.ts";
import type { CarrierMap } from "./carriers.ts";
import { chats, chatInstruction } from "./chats.ts";
import type { Deployment } from "./deployment.ts";
import { assertSecretsStoreIsPrivate } from "./secrets-store.ts";

const privateDirectoryMode = 0o700;
const privateFileMode = 0o600;

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

export function generateConfig(deployment: Deployment, carriers: CarrierMap): void {
  assertOutsideCheckout(deployment);
  assertSecretsStoreIsPrivate(deployment.secretsStore);

  for (const directory of [
    deployment.workspace,
    ...chats.map((subject) => agentWorkspace(deployment, subject)),
    deployment.stateDir,
    deployment.logsDir,
    dirname(deployment.configPath),
  ]) {
    // `mode` applies only to a directory this call creates, and every one of these may already
    // exist at whatever the umask left it — so the mode is set rather than requested.
    mkdirSync(directory, { recursive: true, mode: privateDirectoryMode });
    chmodSync(directory, privateDirectoryMode);
  }

  for (const subject of chats) {
    writeFileSync(
      join(agentWorkspace(deployment, subject), "AGENTS.md"),
      chatInstruction(subject),
      { mode: privateFileMode },
    );
  }
  // The generated file names the Owner's Telegram account, the secrets store and every private
  // root. It is private runtime state by this repository's own definition, so it is written like it.
  writeFileSync(
    deployment.configPath,
    `${JSON.stringify(buildRuntimeConfig(deployment, carriers), null, 2)}\n`,
    { mode: privateFileMode },
  );
  chmodSync(deployment.configPath, privateFileMode);
}
