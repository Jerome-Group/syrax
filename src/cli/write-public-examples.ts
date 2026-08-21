/**
 * Renders the tracked supervision examples from the tracked example deployment, so the public
 * contract is the same text the mini gets rather than a copy that drifts from it.
 *
 *   node src/cli/write-public-examples.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readDeployment, type Deployment } from "../adapter/deployment.ts";
import { gatewayWrapperScript } from "../supervision/gateway-wrapper.ts";
import { gatewayLabel, gatewayLaunchAgentPlist } from "../supervision/launch-agent.ts";

const configDirectory = resolve(import.meta.dirname, "..", "..", "config");

export const exampleDeploymentPath = join(configDirectory, "deployment.example.json");

export function publicExamples(deployment: Deployment): Record<string, string> {
  return {
    [join(configDirectory, "start-gateway.example.sh")]: gatewayWrapperScript(deployment),
    [join(configDirectory, `${gatewayLabel}.example.plist`)]: gatewayLaunchAgentPlist(deployment),
  };
}

export function exampleDeployment(): Deployment {
  return readDeployment(JSON.parse(readFileSync(exampleDeploymentPath, "utf8")));
}

if (import.meta.filename === process.argv[1]) {
  for (const [path, contents] of Object.entries(publicExamples(exampleDeployment()))) {
    writeFileSync(path, contents);
    console.log(path);
  }
}
