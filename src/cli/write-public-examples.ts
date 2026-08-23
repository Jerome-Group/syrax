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
import {
  gatewayLabel,
  gatewayLaunchAgentPlist,
  hatchLabel,
  indexSchedulePlists,
  monitorLaunchAgentPlist,
  searchLabel,
  searchLaunchAgentPlist,
} from "../supervision/launch-agent.ts";
import { monitorWrapperScript } from "../supervision/monitor-wrapper.ts";
import { searchWrapperScript } from "../supervision/search-wrapper.ts";

const configDirectory = resolve(import.meta.dirname, "..", "..", "config");

export const exampleDeploymentPath = join(configDirectory, "deployment.example.json");

/**
 * The example deployment names its own path the way a live one does, so the search wrapper's
 * example is the text the mini gets rather than a copy carrying this checkout's location.
 */
const exampleDeploymentLocation = "/absolute/path/outside/this/repository/deployment.json";

/**
 * The monitor's wrapper names the checkout, since the unit it runs is this repository's own source.
 * The example says so rather than carrying whichever clone rendered it.
 */
const exampleCheckoutLocation = "/absolute/path/to/this/checkout";

export function publicExamples(deployment: Deployment): Record<string, string> {
  const schedules = Object.entries(indexSchedulePlists(deployment)).map(
    ([label, contents]) => [join(configDirectory, `${label}.example.plist`), contents] as const,
  );
  return {
    [join(configDirectory, "start-gateway.example.sh")]: gatewayWrapperScript(deployment),
    [join(configDirectory, `${gatewayLabel}.example.plist`)]: gatewayLaunchAgentPlist(deployment),
    [join(configDirectory, "start-search.example.sh")]: searchWrapperScript(
      deployment,
      exampleDeploymentLocation,
    ),
    [join(configDirectory, `${searchLabel}.example.plist`)]: searchLaunchAgentPlist(deployment),
    [join(configDirectory, "start-monitor.example.sh")]: monitorWrapperScript(
      deployment,
      exampleDeploymentLocation,
      exampleCheckoutLocation,
    ),
    [join(configDirectory, `${hatchLabel}.example.plist`)]: monitorLaunchAgentPlist(deployment),
    ...Object.fromEntries(schedules),
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
