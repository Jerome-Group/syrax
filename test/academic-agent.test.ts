/**
 * The academic desk's unit: the two plists launchd loads — the resident desk and the morning brief's
 * poke — and the pre-flight its wrapper carries. The checks are driven by sourcing the script, which
 * is the only way to point them at roots that are not the machine's own.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { briefPath } from "../src/adapter/academic-tools.ts";
import { readDeployment } from "../src/adapter/deployment.ts";
import { installAcademicAgent } from "../src/cli/install-academic-agent.ts";
import { academicLabel, briefLabel } from "../src/supervision/launch-agent.ts";
import { temporaryMachine, writePrivateSecretsStore } from "./machine.ts";
import { promisify } from "node:util";

const run = promisify(execFile);

/** launchd is macOS's, and so is `stat -f`. */
const onLaunchd = process.platform === "darwin";

function machine() {
  const { root, deployment: described } = temporaryMachine();
  writePrivateSecretsStore(described.secretsStore as string, {
    channels: { telegram: { botToken: "a-bot-token" } },
  });
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  const deployment = readDeployment(described);
  const installed = installAcademicAgent(deployment, join(root, "deployment.json"), home);
  return { root, home, deployment, installed };
}

async function preflight(wrapperPath: string, call: string) {
  try {
    const { stderr } = await run("/bin/bash", ["-c", `source "$1"; ${call}`, "_", wrapperPath], {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
    });
    return { code: 0, stderr };
  } catch (failure) {
    const failed = failure as { code?: number; stderr?: string };
    return { code: failed.code ?? -1, stderr: failed.stderr ?? "" };
  }
}

describe("installing the academic desk's LaunchAgents", () => {
  it("installs the resident desk and the morning brief, and loads neither", () => {
    const { home, installed } = machine();
    assert.deepEqual(installed.plistPaths, [
      join(home, "Library", "LaunchAgents", `${academicLabel}.plist`),
      join(home, "Library", "LaunchAgents", `${briefLabel}.plist`),
    ]);
  });

  it("runs the wrapper rather than the unit, and comes back from a crash", () => {
    const { installed } = machine();
    const plist = readFileSync(installed.plistPaths[0]!, "utf8");
    assert.match(
      plist,
      /<string>\/bin\/bash<\/string>\s*<string>[^<]*start-academic\.sh<\/string>/,
    );
    assert.match(plist, /<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>/);
    assert.equal(plist.includes("EnvironmentVariables"), false);
  });

  it("pokes the resident desk at seven, after the two overnight jobs it reads", () => {
    const { installed, deployment } = machine();
    const plist = readFileSync(installed.plistPaths[1]!, "utf8");
    assert.match(plist, new RegExp(`http://127.0.0.1:${deployment.academicPort}${briefPath}`));
    assert.match(plist, /<key>Hour<\/key>\s*<integer>7<\/integer>/);
    assert.match(plist, /<key>Minute<\/key>\s*<integer>0<\/integer>/);
    assert.equal(plist.includes("StartInterval"), false);
  });

  it(
    "writes a wrapper only its owner can read, since it names every private root",
    {
      skip: !onLaunchd,
    },
    () => {
      const { installed } = machine();
      assert.equal(statSync(installed.wrapperPath).mode & 0o777, 0o700);
    },
  );
});

describe("the academic desk's pre-flight", { skip: !onLaunchd }, () => {
  it("makes the desk's own scratch private, since a Proposal input is the Owner's diary", async () => {
    const { deployment, installed } = machine();
    const ran = await preflight(installed.wrapperPath, "check_state");
    assert.equal(ran.code, 0, ran.stderr);
    assert.equal(statSync(deployment.academic!.academicState).mode & 0o777, 0o700);
  });

  it("refuses to start on a secrets store the machine has left readable", async () => {
    const { deployment, installed } = machine();
    chmodSync(deployment.secretsStore, 0o644);
    const ran = await preflight(installed.wrapperPath, "check_secrets_store");
    assert.equal(ran.code, 2);
    assert.match(ran.stderr, /expected 600/);
  });

  it("warns and proceeds on a product that is not built, so the brief still goes out", async () => {
    const { deployment, installed } = machine();
    rmSync(join(deployment.academic!.academicOsRoot, "dist"), { recursive: true, force: true });
    const ran = await preflight(installed.wrapperPath, "check_products");
    assert.equal(ran.code, 0);
    assert.match(ran.stderr, /npm run build in academic-os/);
  });
});
