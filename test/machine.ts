/**
 * One temporary machine: every root a deployment names, under a directory the test owns. Each
 * suite adds what it needs on top — a secrets store, a stand-in runtime, a home for the plist.
 */

import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ownerTelegramUserId = 100000000;

export function temporaryMachine(overrides: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), "syrax-machine-"));
  return {
    root,
    deployment: {
      runtimeRoot: join(root, "runtime"),
      configPath: join(root, "openclaw.json"),
      stateDir: join(root, "state"),
      workspace: join(root, "workspace"),
      secretsStore: join(root, "secrets", "syrax.json"),
      carrierMap: join(root, "state", "carriers.json"),
      logsDir: join(root, "logs"),
      wrapperPath: join(root, "bin", "start-gateway.sh"),
      ownerTelegramUserId,
      ...overrides,
    },
  };
}

/** The mode the runtime checks at the moment of use, and the generator refuses without. */
export function writePrivateSecretsStore(path: string, contents: unknown = {}): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(contents));
  chmodSync(path, 0o600);
  chmodSync(join(path, ".."), 0o700);
  return path;
}
