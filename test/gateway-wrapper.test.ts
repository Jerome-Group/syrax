/**
 * The pre-flight is shell, so it is tested by running it: the generated wrapper is executed against
 * a stand-in runtime whose exit codes the test scripts, and its two directory checks are driven
 * directly by sourcing the script, which is the only way to point them at a directory that is not
 * the machine's own.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { readDeployment } from "../src/adapter/deployment.ts";
import {
  captureBasename,
  gatewayWrapperScript,
  scratchRoot,
} from "../src/supervision/gateway-wrapper.ts";
import { temporaryMachine, writePrivateSecretsStore } from "./machine.ts";

const run = promisify(execFile);

/** launchd is macOS's, and so are `stat -f` and `pmset`. */
const onLaunchd = process.platform === "darwin";

/**
 * The scratch root is the one path the wrapper cannot be pointed away from, so these run against
 * the machine's own. A host that has left it readable is what the check is for, not a test failure.
 */
const hostScratchRootIsPrivate =
  !existsSync(scratchRoot) || (statSync(scratchRoot).mode & 0o777) === 0o700;

type Ran = { code: number; stdout: string; stderr: string };

async function bash(args: string[], environment: Record<string, string>): Promise<Ran> {
  try {
    const { stdout, stderr } = await run("/bin/bash", args, {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...environment },
    });
    return { code: 0, stdout, stderr };
  } catch (failure) {
    const failed = failure as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? -1, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
}

/** A stand-in for the pinned runtime: `secrets audit` exits what the test asked for, `gateway` runs. */
function machine(auditExitCode: number) {
  const { root, deployment: described } = temporaryMachine();
  const runtimeRoot = described.runtimeRoot as string;
  const started = join(root, "gateway-started");
  mkdirSync(join(runtimeRoot, "node_modules", "openclaw"), { recursive: true });
  writeFileSync(
    join(runtimeRoot, "node_modules", "openclaw", "openclaw.mjs"),
    `import { writeFileSync } from "node:fs";
const command = process.argv.slice(2).join(" ");
if (command === "secrets audit --check") process.exit(${auditExitCode});
console.log("a line the runtime's own log already has");
writeFileSync(${JSON.stringify(started)}, command);
`,
  );

  writePrivateSecretsStore(described.secretsStore as string);

  const deployment = readDeployment(described);
  mkdirSync(join(root, "bin"), { recursive: true });
  writeFileSync(deployment.wrapperPath, gatewayWrapperScript(deployment), { mode: 0o700 });
  return {
    root,
    deployment,
    started,
    capture: join(deployment.logsDir, captureBasename),
    temporary: mkdtempSync(join(tmpdir(), "syrax-lock-")),
  };
}

describe(
  "the gateway wrapper's pre-flight",
  { skip: !onLaunchd || !hostScratchRootIsPrivate },
  () => {
    it("starts the gateway when every check passes", async () => {
      const { deployment, started, temporary } = machine(0);
      const ran = await bash([deployment.wrapperPath], { TMPDIR: temporary });
      assert.equal(ran.code, 0, ran.stderr);
      assert.equal(existsSync(started), true, "the wrapper never reached the runtime.");
    });

    it("proceeds with a warning on a posture finding, because it should not cost the chatbot", async () => {
      const { deployment, started, temporary, capture } = machine(1);
      const ran = await bash([deployment.wrapperPath], { TMPDIR: temporary });
      assert.equal(ran.code, 0, ran.stderr);
      assert.match(readFileSync(capture, "utf8"), /posture finding/);
      assert.equal(existsSync(started), true);
    });

    it("refuses to start on an unresolved ref, which is worse than not coming up", async () => {
      const { deployment, started, temporary, capture } = machine(2);
      const ran = await bash([deployment.wrapperPath], { TMPDIR: temporary });
      assert.equal(ran.code, 2);
      assert.match(readFileSync(capture, "utf8"), /secrets audit exits 2/);
      assert.equal(existsSync(started), false, "the gateway started with a ref it cannot resolve.");
    });

    it("keeps what the runtime's own log does not have, and drops what it does", async () => {
      const { deployment, temporary, capture } = machine(1);
      await bash([deployment.wrapperPath], { TMPDIR: temporary });
      const captured = readFileSync(capture, "utf8");
      assert.match(captured, /posture finding/);
      assert.doesNotMatch(captured, /a line the runtime's own log already has/);
    });

    it("keeps the capture private, whatever mode an earlier start left it in", async () => {
      const { deployment, temporary, capture } = machine(0);
      mkdirSync(deployment.logsDir, { recursive: true });
      writeFileSync(capture, "left readable\n");
      chmodSync(capture, 0o644);

      await bash([deployment.wrapperPath], { TMPDIR: temporary });
      assert.equal(statSync(capture).mode & 0o777, 0o600);
    });

    it("rolls the capture past its bound, keeping one previous copy", async () => {
      const { deployment, temporary, capture } = machine(0);
      mkdirSync(deployment.logsDir, { recursive: true });
      writeFileSync(capture, "x".repeat(5 * 1024 * 1024 + 1));

      await bash([deployment.wrapperPath], { TMPDIR: temporary });
      assert.equal(existsSync(capture.replace(/\.log$/, ".1.log")), true, "nothing was rolled.");
      assert.ok(statSync(capture).size < 1024, "the capture kept growing past its bound.");
    });

    it("ensures the gateway lock directory private, since mkdir does not chmod what it finds", async () => {
      const { deployment, temporary } = machine(0);
      const lock = join(temporary, `openclaw-${process.getuid?.()}`);
      mkdirSync(lock);
      chmodSync(lock, 0o755);

      const ran = await bash([deployment.wrapperPath], { TMPDIR: temporary });
      assert.equal(ran.code, 0, ran.stderr);
      assert.equal(statSync(lock).mode & 0o777, 0o700);
    });

    it("creates the logs directory private, since launchd never opens a file there itself", async () => {
      const { deployment, temporary } = machine(0);
      const ran = await bash([deployment.wrapperPath], { TMPDIR: temporary });
      assert.equal(ran.code, 0, ran.stderr);
      assert.equal(statSync(deployment.logsDir).mode & 0o777, 0o700);
    });

    it("refuses a directory the machine has left readable, and tolerates one that is absent", async () => {
      const { deployment, root } = machine(0);
      const readable = join(root, "readable");
      mkdirSync(readable, { mode: 0o755 });
      chmodSync(readable, 0o755);

      const call = 'source "$1"; assert_private "$2"';
      const refused = await bash(["-c", call, "_", deployment.wrapperPath, readable], {});
      assert.equal(refused.code, 2);
      assert.match(refused.stderr, /mode 755, expected 700/);

      const absent = await bash(["-c", call, "_", deployment.wrapperPath, join(root, "gone")], {});
      assert.equal(absent.code, 0, absent.stderr);
    });

    it("asserts the scratch root the runtime takes no setting for", () => {
      const { deployment } = machine(0);
      assert.match(gatewayWrapperScript(deployment), /scratch_root='\/tmp\/openclaw'/);
      assert.equal(scratchRoot, "/tmp/openclaw");
    });
  },
);
