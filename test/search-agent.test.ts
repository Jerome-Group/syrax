/**
 * The second unit, and the schedules that poke it. The plists are read as text; the pre-flight is
 * shell, so it is tested the way the gateway's is — by running the generated wrapper against a
 * stand-in environment whose pieces the test puts in place or leaves out.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { readDeployment } from "../src/adapter/deployment.ts";
import { installSearchAgent } from "../src/cli/install-search-agent.ts";
import {
  fullIndexLabel,
  incrementalIndexLabel,
  searchLabel,
} from "../src/supervision/launch-agent.ts";
import { searchCaptureBasename } from "../src/supervision/search-wrapper.ts";
import { captureBasename } from "../src/supervision/gateway-wrapper.ts";
import { temporaryMachine } from "./machine.ts";

const run = promisify(execFile);
const executable = 0o700;

function machine() {
  const { root, deployment } = temporaryMachine();
  const home = join(root, "home");
  mkdirSync(home);
  return { root, home, deployment: readDeployment(deployment) };
}

function installed() {
  const { root, home, deployment } = machine();
  const agent = installSearchAgent(deployment, join(root, "deployment.json"), home);
  const plists = Object.fromEntries(
    agent.plistPaths.map((path) => [path.split("/").pop(), readFileSync(path, "utf8")]),
  );
  return { root, home, deployment, agent, plists };
}

/** The environment the pre-flight expects to find, minus whatever a test wants missing. */
function provision(deployment: ReturnType<typeof readDeployment>, parts: string[]) {
  if (parts.includes("interpreter")) {
    const binary = join(deployment.searchRoot, "bin", "python");
    mkdirSync(join(deployment.searchRoot, "bin"), { recursive: true });
    writeFileSync(binary, "#!/bin/bash\nexit 0\n", { mode: executable });
  }
  if (parts.includes("export")) {
    const exported = join(deployment.searchIndex, "models", "embeddinggemma-300m-onnx");
    mkdirSync(exported, { recursive: true });
    writeFileSync(join(exported, "model_q4.onnx"), "");
    writeFileSync(join(exported, "tokenizer.json"), "{}");
  }
  if (parts.includes("index")) {
    mkdirSync(deployment.searchIndex, { recursive: true });
    writeFileSync(join(deployment.searchIndex, "index.sqlite"), "");
  }
}

async function preflight(wrapperPath: string): Promise<{ code: number; stderr: string }> {
  try {
    const { stderr } = await run("/bin/bash", ["-c", `source ${wrapperPath}; preflight`]);
    return { code: 0, stderr };
  } catch (failure) {
    const failed = failure as { code?: number; stderr?: string };
    return { code: failed.code ?? -1, stderr: failed.stderr ?? "" };
  }
}

describe("the search unit's LaunchAgent", () => {
  it("takes the gateway's shape: a wrapper, RunAtLoad, and a crash that comes back", () => {
    const { plists } = installed();
    const plist = plists[`${searchLabel}.plist`];
    assert.match(plist, /<string>\/bin\/bash<\/string>\s*<string>[^<]*start-search\.sh<\/string>/);
    assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
    assert.match(plist, /<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>/);
    assert.match(plist, /<key>ThrottleInterval<\/key>\s*<integer>10<\/integer>/);
  });

  it("carries no environment block and names no capture path, as the gateway's does not", () => {
    const { plists } = installed();
    const plist = plists[`${searchLabel}.plist`];
    assert.equal(plist.includes("EnvironmentVariables"), false);
    assert.equal(plist.includes("StandardOutPath"), false);
    assert.notEqual(searchCaptureBasename, captureBasename, "two units, two captures.");
  });

  it("writes its wrapper private and executable, since it is what launchd runs", () => {
    const { agent } = installed();
    assert.equal(statSync(agent.wrapperPath).mode & 0o777, executable);
  });

  it("parses as a property list", { skip: process.platform !== "darwin" }, async () => {
    const { agent } = installed();
    for (const path of agent.plistPaths) {
      const { stdout } = await run("/usr/bin/plutil", ["-p", path]);
      assert.match(stdout, /Label/);
    }
  });
});

describe("the index schedules", () => {
  it("re-embeds every third day, and reads the hourly pass in between", () => {
    const { plists } = installed();
    const full = plists[`${fullIndexLabel}.plist`];
    const incremental = plists[`${incrementalIndexLabel}.plist`];

    const days = [...full.matchAll(/<integer>(\d+)<\/integer>/g)].map((one) => Number(one[1]));
    const calendar = days.slice(0, 10);
    assert.deepEqual(calendar, [1, 4, 7, 10, 13, 16, 19, 22, 25, 28]);
    assert.equal(incremental.includes("<key>Day</key>"), false, "hourly names no day.");
    assert.match(incremental, /<key>Minute<\/key>\s*<integer>17<\/integer>/);
  });

  it("adds no unit for the benchmark or for a re-embed asked for on demand", () => {
    const { agent, home } = installed();
    assert.deepEqual(
      agent.plistPaths.map((path) => path.slice(home.length)),
      [searchLabel, incrementalIndexLabel, fullIndexLabel].map(
        (label) => `/Library/LaunchAgents/${label}.plist`,
      ),
      "a schedule of its own is what ADR-0007 says the loop does not get.",
    );
  });

  it("pokes the resident unit rather than loading a second embedder", () => {
    const { plists, deployment } = installed();
    for (const [label, pass] of [
      [incrementalIndexLabel, "incremental"],
      [fullIndexLabel, "full"],
    ]) {
      const plist = plists[`${label}.plist`];
      assert.match(plist, /<string>\/usr\/bin\/curl<\/string>/);
      assert.ok(plist.includes(`http://127.0.0.1:${deployment.searchPort}/index/${pass}`));
    }
  });
});

describe("the search pre-flight", () => {
  it("proceeds once the environment, the export and an index are there", async () => {
    const { agent, deployment } = installed();
    provision(deployment, ["interpreter", "export", "index"]);
    assert.equal((await preflight(agent.wrapperPath)).code, 0);
  });

  it("refuses on a missing export, since every query is embedded before it is answered", async () => {
    const { agent, deployment } = installed();
    provision(deployment, ["interpreter", "index"]);
    const refused = await preflight(agent.wrapperPath);
    assert.equal(refused.code, 2);
    assert.match(refused.stderr, /pinned export/);
  });

  it("refuses when the environment was never created", async () => {
    const { agent, deployment } = installed();
    provision(deployment, ["export", "index"]);
    const refused = await preflight(agent.wrapperPath);
    assert.equal(refused.code, 2);
    assert.match(refused.stderr, /environment/);
  });

  it("warns rather than refuses on a first run with no index yet", async () => {
    const { agent, deployment } = installed();
    provision(deployment, ["interpreter", "export"]);
    const started = await preflight(agent.wrapperPath);
    assert.equal(started.code, 0);
    assert.match(started.stderr, /no index yet/);
  });

  it("makes the index root private, since it holds private text verbatim", async () => {
    const { agent, deployment } = installed();
    provision(deployment, ["interpreter", "export", "index"]);
    await preflight(agent.wrapperPath);
    assert.equal(statSync(deployment.searchIndex).mode & 0o777, 0o700);
  });
});
