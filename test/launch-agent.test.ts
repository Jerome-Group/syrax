import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { readDeployment } from "../src/adapter/deployment.ts";
import { installGatewayAgent } from "../src/cli/install-gateway-agent.ts";
import { captureBasename } from "../src/supervision/gateway-wrapper.ts";
import { gatewayLabel } from "../src/supervision/launch-agent.ts";
import { temporaryMachine } from "./machine.ts";

const run = promisify(execFile);

function machine(logsDirName = "logs") {
  const { root, deployment } = temporaryMachine();
  const home = join(root, "home");
  mkdirSync(home);
  return {
    home,
    deployment: readDeployment({ ...deployment, logsDir: join(root, logsDirName) }),
  };
}

describe("installing the gateway's LaunchAgent", () => {
  it("runs the wrapper rather than the binary, and comes back from a crash", () => {
    const { home, deployment } = machine();
    const installed = installGatewayAgent(deployment, home);
    const plist = readFileSync(installed.plistPath, "utf8");

    assert.equal(
      installed.plistPath,
      join(home, "Library", "LaunchAgents", `${gatewayLabel}.plist`),
    );
    assert.match(plist, /<string>\/bin\/bash<\/string>\s*<string>[^<]*start-gateway\.sh<\/string>/);
    assert.match(plist, /<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>/);
    assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
    assert.match(plist, /<key>ThrottleInterval<\/key>\s*<integer>10<\/integer>/);
  });

  it("carries no environment block, so no credential can ever be added to one", () => {
    const { home, deployment } = machine();
    const plist = readFileSync(installGatewayAgent(deployment, home).plistPath, "utf8");
    assert.equal(plist.includes("EnvironmentVariables"), false);
  });

  it("names no capture path, since launchd cannot open one on the volume the logs are on", () => {
    const { home, deployment } = machine();
    const plist = readFileSync(installGatewayAgent(deployment, home).plistPath, "utf8");
    assert.equal(plist.includes("StandardOutPath"), false);
    assert.equal(plist.includes("StandardErrorPath"), false);
    assert.doesNotMatch(captureBasename, /^openclaw-/, "the runtime's own prune would eat it.");
  });

  it("writes the wrapper private and executable, since it is what launchd runs", () => {
    const { home, deployment } = machine();
    const installed = installGatewayAgent(deployment, home);
    assert.equal(statSync(installed.wrapperPath).mode & 0o777, 0o700);
  });

  it("parses as a property list", { skip: process.platform !== "darwin" }, async () => {
    const { home, deployment } = machine();
    const installed = installGatewayAgent(deployment, home);
    const { stdout } = await run("/usr/bin/plutil", ["-p", installed.plistPath]);
    assert.match(stdout, new RegExp(gatewayLabel));
  });
});
