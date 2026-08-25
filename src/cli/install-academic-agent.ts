/**
 * Writes the academic desk's wrapper and its two LaunchAgents — the resident unit and the morning
 * brief's poke — and loads neither. Bootstrapping is the Owner's command, as it is for the others.
 *
 *   node src/cli/install-academic-agent.ts <deployment.json>
 *
 * The checkout is passed into the wrapper because the unit it runs is this repository's own source.
 */

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { type Deployment, readDeployment } from "../adapter/deployment.ts";
import {
  academicLabel,
  academicLaunchAgentPlist,
  briefLabel,
  briefPlist,
  launchAgentPath,
} from "../supervision/launch-agent.ts";
import { academicWrapperScript } from "../supervision/academic-wrapper.ts";

const executableMode = 0o700;

export const checkout = resolve(import.meta.dirname, "..", "..");

export type InstalledAcademicAgent = { wrapperPath: string; plistPaths: string[] };

export function installAcademicAgent(
  deployment: Deployment,
  deploymentPath: string,
  home: string,
): InstalledAcademicAgent {
  if (deployment.academicWrapperPath === "") {
    throw new Error(
      "the deployment names no academicWrapperPath, so there is nowhere to write the desk's wrapper.",
    );
  }
  mkdirSync(dirname(deployment.academicWrapperPath), { recursive: true });
  writeFileSync(
    deployment.academicWrapperPath,
    academicWrapperScript(deployment, deploymentPath, checkout),
    { mode: executableMode },
  );
  chmodSync(deployment.academicWrapperPath, executableMode);

  const plists = {
    [academicLabel]: academicLaunchAgentPlist(deployment),
    [briefLabel]: briefPlist(deployment),
  };
  const plistPaths = Object.entries(plists).map(([label, contents]) => {
    const path = launchAgentPath(home, label);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
    return path;
  });

  return { wrapperPath: deployment.academicWrapperPath, plistPaths };
}

if (import.meta.filename === process.argv[1]) {
  const source = process.argv[2];
  if (source === undefined) {
    console.error("usage: install-academic-agent <deployment.json>");
    process.exit(2);
  }
  const deploymentPath = resolve(source);
  const deployment = readDeployment(JSON.parse(await readFile(deploymentPath, "utf8")));
  const installed = installAcademicAgent(deployment, deploymentPath, homedir());
  console.log(installed.wrapperPath);
  for (const path of installed.plistPaths) {
    console.log(path);
    console.log(`launchctl bootstrap gui/$(id -u) "${path}"`);
  }
}
