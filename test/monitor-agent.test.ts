/**
 * The lane monitor's unit: the plist launchd loads, and the pre-flight its wrapper carries. The
 * checks are driven by sourcing the script, which is the only way to point them at a store and a
 * state directory that are not the machine's own.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { readDeployment } from "../src/adapter/deployment.ts";
import { checkout, installMonitorAgent } from "../src/cli/install-monitor-agent.ts";
import { hatchLabel } from "../src/supervision/launch-agent.ts";
import { temporaryMachine, writePrivateSecretsStore } from "./machine.ts";

const run = promisify(execFile);

/** launchd is macOS's, and so is `stat -f`. */
const onLaunchd = process.platform === "darwin";

function machine() {
  const { root, deployment: described } = temporaryMachine();
  writePrivateSecretsStore(described.secretsStore as string, {
    providers: { gemini: { apiKey: "a-gemini-key" } },
  });
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  const deployment = readDeployment(described);
  const installed = installMonitorAgent(deployment, join(root, "deployment.json"), home);
  return { root, home, deployment, installed };
}

async function preflight(wrapperPath: string, call: string, ...args: string[]) {
  try {
    const { stderr } = await run(
      "/bin/bash",
      ["-c", `source "$1"; ${call}`, "_", wrapperPath, ...args],
      {
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      },
    );
    return { code: 0, stderr };
  } catch (failure) {
    const failed = failure as { code?: number; stderr?: string };
    return { code: failed.code ?? -1, stderr: failed.stderr ?? "" };
  }
}

describe("installing the lane monitor's LaunchAgent", () => {
  it("keeps the label the hatch had, since renaming it is a redeploy for a word", () => {
    const { home, installed } = machine();
    assert.equal(installed.plistPath, join(home, "Library", "LaunchAgents", `${hatchLabel}.plist`));
    assert.equal(hatchLabel, "com.jerome-group.syrax.hatch");
  });

  it("runs the wrapper rather than the unit, and comes back from a crash", () => {
    const { installed } = machine();
    const plist = readFileSync(installed.plistPath, "utf8");
    assert.match(plist, /<string>\/bin\/bash<\/string>\s*<string>[^<]*start-monitor\.sh<\/string>/);
    assert.match(plist, /<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>/);
    assert.equal(plist.includes("EnvironmentVariables"), false);
  });

  it("writes the wrapper private and executable, since it is what launchd runs", () => {
    const { installed } = machine();
    assert.equal(statSync(installed.wrapperPath).mode & 0o777, 0o700);
  });

  it("runs this repository's own source, which is where the unit lives", () => {
    const { installed } = machine();
    const wrapper = readFileSync(installed.wrapperPath, "utf8");
    const unit = join(checkout, "src", "cli", "serve-monitor.ts");
    assert.ok(wrapper.includes(unit), "the wrapper names no unit to run.");
    assert.equal(existsSync(unit), true);
  });
});

describe("the lane monitor's pre-flight", { skip: !onLaunchd }, () => {
  it("makes the counters' directory private, since a lost counter hands an allowance back", async () => {
    const { deployment, installed } = machine();
    const ran = await preflight(installed.wrapperPath, "check_state");
    assert.equal(ran.code, 0, ran.stderr);
    assert.equal(statSync(deployment.monitorState).mode & 0o777, 0o700);
  });

  it("takes an existing state directory the machine has left readable back to private", async () => {
    const { deployment, installed } = machine();
    mkdirSync(deployment.monitorState, { recursive: true });
    chmodSync(deployment.monitorState, 0o755);

    const ran = await preflight(installed.wrapperPath, "check_state");
    assert.equal(ran.code, 0, ran.stderr);
    assert.equal(statSync(deployment.monitorState).mode & 0o777, 0o700);
  });

  it("refuses a store the machine has left readable rather than using it", async () => {
    const { deployment, installed } = machine();
    chmodSync(deployment.secretsStore, 0o644);

    const ran = await preflight(installed.wrapperPath, "check_secrets_store");
    assert.equal(ran.code, 2);
    assert.match(ran.stderr, /mode 644, expected 600/);
  });

  it("refuses a store that is not there, which is a machine the wizard has not run on", async () => {
    const { root, deployment, installed } = machine();
    writeFileSync(join(root, "moved"), "");
    const gone = readDeployment({ ...deployment, secretsStore: join(root, "gone", "syrax.json") });
    const wrapper = join(root, "gone-wrapper.sh");
    writeFileSync(
      wrapper,
      readFileSync(installed.wrapperPath, "utf8").replace(
        deployment.secretsStore,
        gone.secretsStore,
      ),
    );

    const ran = await preflight(wrapper, "check_secrets_store");
    assert.equal(ran.code, 2);
    assert.match(ran.stderr, /the wizard has not run/);
  });

  it("passes on a store the wizard left as it should", async () => {
    const { installed } = machine();
    const ran = await preflight(installed.wrapperPath, "check_secrets_store");
    assert.equal(ran.code, 0, ran.stderr);
  });
});
