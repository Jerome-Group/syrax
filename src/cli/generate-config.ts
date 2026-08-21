/**
 * Writes the generated runtime configuration and the workspace file beside it, refusing before it
 * writes rather than leaving a gateway that comes up and fails every turn.
 *
 *   node src/cli/generate-config.ts <deployment.json>
 */

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { buildRuntimeConfig } from "../adapter/build.ts";
import { type Deployment, readDeployment } from "../adapter/deployment.ts";
import { standingInstruction } from "../adapter/general-agent.ts";
import { assertSecretsStoreIsPrivate } from "../adapter/secrets-store.ts";

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

export function generateConfig(deployment: Deployment): void {
  assertOutsideCheckout(deployment);
  assertSecretsStoreIsPrivate(deployment.secretsStore);

  for (const directory of [
    deployment.workspace,
    deployment.stateDir,
    deployment.logsDir,
    dirname(deployment.configPath),
  ]) {
    // `mode` applies only to a directory this call creates, and every one of these may already
    // exist at whatever the umask left it — so the mode is set rather than requested.
    mkdirSync(directory, { recursive: true, mode: privateDirectoryMode });
    chmodSync(directory, privateDirectoryMode);
  }

  writeFileSync(join(deployment.workspace, "AGENTS.md"), standingInstruction);
  // The generated file names the Owner's Telegram account, the secrets store and every private
  // root. It is private runtime state by this repository's own definition, so it is written like it.
  writeFileSync(
    deployment.configPath,
    `${JSON.stringify(buildRuntimeConfig(deployment), null, 2)}\n`,
    { mode: privateFileMode },
  );
  chmodSync(deployment.configPath, privateFileMode);
}

if (import.meta.filename === process.argv[1]) {
  const source = process.argv[2];
  if (source === undefined) {
    console.error("usage: generate-config <deployment.json>");
    process.exit(2);
  }
  const deployment = readDeployment(
    JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(source, "utf8"))),
  );
  generateConfig(deployment);
  console.log(deployment.configPath);
}
