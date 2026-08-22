/**
 * Writes the search unit's wrapper, its LaunchAgent and the two index schedules, and loads none of
 * them. Bootstrapping is the Owner's command, as it is for the gateway.
 *
 *   node src/cli/install-search-agent.ts <deployment.json>
 *
 * The deployment's own path is passed through into the wrapper: the unit reads the same file this
 * installer read, so a root can never be named twice and drift between the two languages.
 */

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { type Deployment, readDeployment } from "../adapter/deployment.ts";
import {
  indexSchedulePlists,
  launchAgentPath,
  searchLabel,
  searchLaunchAgentPlist,
} from "../supervision/launch-agent.ts";
import { searchWrapperScript } from "../supervision/search-wrapper.ts";

const executableMode = 0o700;

export type InstalledSearchAgent = { wrapperPath: string; plistPaths: string[] };

export function installSearchAgent(
  deployment: Deployment,
  deploymentPath: string,
  home: string,
): InstalledSearchAgent {
  mkdirSync(dirname(deployment.searchWrapperPath), { recursive: true });
  writeFileSync(deployment.searchWrapperPath, searchWrapperScript(deployment, deploymentPath), {
    mode: executableMode,
  });
  chmodSync(deployment.searchWrapperPath, executableMode);

  const plists = {
    [searchLabel]: searchLaunchAgentPlist(deployment),
    ...indexSchedulePlists(deployment),
  };
  const plistPaths = Object.entries(plists).map(([label, contents]) => {
    const path = launchAgentPath(home, label);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
    return path;
  });

  return { wrapperPath: deployment.searchWrapperPath, plistPaths };
}

if (import.meta.filename === process.argv[1]) {
  const source = process.argv[2];
  if (source === undefined) {
    console.error("usage: install-search-agent <deployment.json>");
    process.exit(2);
  }
  const deploymentPath = resolve(source);
  const deployment = readDeployment(JSON.parse(await readFile(deploymentPath, "utf8")));
  const installed = installSearchAgent(deployment, deploymentPath, homedir());
  console.log(installed.wrapperPath);
  for (const path of installed.plistPaths) {
    console.log(path);
    console.log(`launchctl bootstrap gui/$(id -u) "${path}"`);
  }
}
