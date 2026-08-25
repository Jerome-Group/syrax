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
      academicWrapperPath: join(root, "bin", "start-academic.sh"),
      // The academic pair, stood where a machine holding both checkouts would name them. A suite
      // that drives the desk writes stand-in products at these paths; one that does not never runs
      // them, and the generator only asks that they are named.
      academicOsRoot: join(root, "academic-os"),
      academicOsConfig: join(root, "academic-os", "academic-os.config.json"),
      academicOsState: join(root, "academic-state"),
      ntulearnRoot: join(root, "ntulearn"),
      ntulearnState: join(root, "ntulearn-state"),
      academicState: join(root, "academic-desk"),
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
 * A stand-in for the pinned runtime at the path the deployment names: it records every command
 * Syrax runs against it and the configuration it was pointed at, and answers the three gateway
 * methods a landing asks — quiet, stop and start, and *is the channel back*. It is the seam the
 * lander's **sequence** is observed at; that the sequence works against a real gateway is measured
 * where it has to be, in `test/stand-down.test.ts` and `docs/research/`.
 *
 * `wedged` is a channel that never comes back up, which is how the fall-through to the safe restart
 * is observed without one.
 */
export function standInRuntime(runtimeRoot: string, options: { wedged?: boolean } = {}): string {
  const entrypoint = runtimeEntrypoint(runtimeRoot);
  const log = join(runtimeRoot, "commands.log");
  mkdirSync(dirname(entrypoint), { recursive: true });
  writeFileSync(
    entrypoint,
    `import { appendFileSync } from "node:fs";
const ran = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, \`\${ran.join(" ")} \${process.env.OPENCLAW_CONFIG_PATH}\n\`);
const method = ran[0] === "gateway" && ran[1] === "call" ? ran[2] : "";
const answers = {
  "gateway.restart.preflight": { safe: true, counts: { totalActive: 0 }, blockers: [] },
  "channels.stop": { stopped: true },
  "channels.start": { started: true },
  "channels.status": {
    channelAccounts: {
      telegram: [{ accountId: "default", running: ${options.wedged ? "false" : "true"}, connected: ${options.wedged ? "false" : "true"} }],
    },
  },
};
if (method) process.stdout.write(JSON.stringify(answers[method] ?? {}));
`,
  );
  return log;
}
