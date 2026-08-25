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
import { removedRungs } from "./removal-ledger.ts";
import { standingDown } from "./stand-down-ledger.ts";
import { assertSecretsStoreIsPrivate } from "./secrets-store.ts";

const checkout = resolve(import.meta.dirname, "..", "..");

/** Placement is the control, not the ignore rule: a root inside the checkout is committable. */
function assertOutsideCheckout(deployment: Deployment): void {
  for (const [key, value] of Object.entries({ ...deployment, ...deployment.academic })) {
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

/**
 * Every write of the file goes through here, which is what keeps a stand down from being reverted
 * by one: the ledgers are asked rather than the file the last write left behind (ADR-0009). Both
 * are asked, because a chain is composed without a rung whether it is out until a reset or out for
 * good (ADR-0012), and the difference between the two is which ledger holds it rather than what the
 * generated file says.
 */
function absentRungs(deployment: Deployment): string[] {
  return [
    ...standingDown(deployment.monitorState).map((held) => held.rung),
    ...removedRungs(deployment.monitorState).map((held) => held.rung),
  ];
}

/**
 * A machine that names no academic products is a machine whose Academic chat would carry seven tools
 * with nothing behind them — every call answering *this machine names no academic products* at the
 * moment the Owner asked, which is ADR-0019's refusal exactly: refuse before the write rather than
 * come up and be wrong.
 */
function assertTheAcademicPairIsConfigured(deployment: Deployment): void {
  if (deployment.academic !== undefined) return;
  throw new Error(
    "the deployment names no academic products, so the Academic chat's tools would answer nothing. " +
      "Add academicOsRoot, academicOsConfig, academicOsState, ntulearnRoot, ntulearnState and " +
      "academicState, each an absolute path outside this checkout.",
  );
}

export function generateConfig(deployment: Deployment, carriers: CarrierMap): void {
  assertOutsideCheckout(deployment);
  assertEveryScopeIsConfigured(deployment);
  assertTheAcademicPairIsConfigured(deployment);
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
    `${JSON.stringify(buildRuntimeConfig(deployment, carriers, absentRungs(deployment)), null, 2)}\n`,
  );
}
