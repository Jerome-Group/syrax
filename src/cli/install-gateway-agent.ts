/**
 * Writes the two files supervision needs — the wrapper and the LaunchAgent that runs it — and loads
 * neither. Bootstrapping is the Owner's command.
 *
 *   node src/cli/install-gateway-agent.ts <deployment.json>
 */

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { type Deployment, readDeployment } from "../adapter/deployment.ts";
import { gatewayWrapperScript } from "../supervision/gateway-wrapper.ts";
import { gatewayLaunchAgentPlist, launchAgentPath } from "../supervision/launch-agent.ts";

const executableMode = 0o700;

export type InstalledAgent = { wrapperPath: string; plistPath: string };

export function installGatewayAgent(deployment: Deployment, home: string): InstalledAgent {
  mkdirSync(dirname(deployment.wrapperPath), { recursive: true });
  writeFileSync(deployment.wrapperPath, gatewayWrapperScript(deployment), { mode: executableMode });
  chmodSync(deployment.wrapperPath, executableMode);

  const plistPath = launchAgentPath(home);
  mkdirSync(dirname(plistPath), { recursive: true });
  writeFileSync(plistPath, gatewayLaunchAgentPlist(deployment));

  return { wrapperPath: deployment.wrapperPath, plistPath };
}

if (import.meta.filename === process.argv[1]) {
  const source = process.argv[2];
  if (source === undefined) {
    console.error("usage: install-gateway-agent <deployment.json>");
    process.exit(2);
  }
  const deployment = readDeployment(JSON.parse(await readFile(source, "utf8")));
  const installed = installGatewayAgent(deployment, homedir());
  console.log(installed.wrapperPath);
  console.log(installed.plistPath);
  console.log(`launchctl bootstrap gui/$(id -u) "${installed.plistPath}"`);
}
