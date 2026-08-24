/**
 * One temporary machine: every root a deployment names, under a directory the test owns. Each
 * suite adds what it needs on top — a secrets store, a stand-in runtime, a home for the plist.
 */

import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runtimeEntrypoint } from "../src/adapter/runtime-command.ts";

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
      searchRoot: join(root, "search-env"),
      searchIndex: join(root, "search-index"),
      searchWrapperPath: join(root, "bin", "start-search.sh"),
      monitorState: join(root, "lane-monitor"),
      monitorWrapperPath: join(root, "bin", "start-monitor.sh"),
      // A machine with an Academic chat is a machine that has told the search unit where its
      // modules live; the generator refuses to write a chat a scope with no root behind it.
      searchScopes: { academic: join(root, "corpus", "modules") },
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

/**
 * A stand-in for the pinned runtime at the path the deployment names, which records the commands
 * Syrax runs against it and the configuration it was pointed at. It is the seam a stand down's
 * lander is observed at: what matters is which call was issued, not what a real gateway would have
 * done with it — which is measured against a real one where it has to be.
 */
export function standInRuntime(runtimeRoot: string): string {
  const entrypoint = runtimeEntrypoint(runtimeRoot);
  const log = join(runtimeRoot, "commands.log");
  mkdirSync(dirname(entrypoint), { recursive: true });
  writeFileSync(
    entrypoint,
    `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(log)}, \`\${process.argv.slice(2).join(" ")} \${process.env.OPENCLAW_CONFIG_PATH}\n\`);
`,
  );
  return log;
}
