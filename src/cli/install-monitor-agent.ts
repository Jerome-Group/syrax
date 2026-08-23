/**
 * Writes the lane monitor's wrapper and its LaunchAgent, and loads neither. Bootstrapping is the
 * Owner's command, as it is for the other two units.
 *
 *   node src/cli/install-monitor-agent.ts <deployment.json>
 *
 * The checkout is passed into the wrapper because the unit it runs is this repository's own source:
 * the gateway and the search unit are installed trees outside the checkout, and this one is not.
 */

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { type Deployment, readDeployment } from "../adapter/deployment.ts";
import {
  hatchLabel,
  launchAgentPath,
  monitorLaunchAgentPlist,
} from "../supervision/launch-agent.ts";
import { monitorWrapperScript } from "../supervision/monitor-wrapper.ts";

const executableMode = 0o700;

export const checkout = resolve(import.meta.dirname, "..", "..");

export type InstalledMonitorAgent = { wrapperPath: string; plistPath: string };

export function installMonitorAgent(
  deployment: Deployment,
  deploymentPath: string,
  home: string,
): InstalledMonitorAgent {
  mkdirSync(dirname(deployment.monitorWrapperPath), { recursive: true });
  writeFileSync(
    deployment.monitorWrapperPath,
    monitorWrapperScript(deployment, deploymentPath, checkout),
    { mode: executableMode },
  );
  chmodSync(deployment.monitorWrapperPath, executableMode);

  const plistPath = launchAgentPath(home, hatchLabel);
  mkdirSync(dirname(plistPath), { recursive: true });
  writeFileSync(plistPath, monitorLaunchAgentPlist(deployment));

  return { wrapperPath: deployment.monitorWrapperPath, plistPath };
}

if (import.meta.filename === process.argv[1]) {
  const source = process.argv[2];
  if (source === undefined) {
    console.error("usage: install-monitor-agent <deployment.json>");
    process.exit(2);
  }
  const deploymentPath = resolve(source);
  const deployment = readDeployment(JSON.parse(await readFile(deploymentPath, "utf8")));
  const installed = installMonitorAgent(deployment, deploymentPath, homedir());
  console.log(installed.wrapperPath);
  console.log(installed.plistPath);
  console.log(`launchctl bootstrap gui/$(id -u) "${installed.plistPath}"`);
}
