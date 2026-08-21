/**
 * Writes the runtime's configuration from a deployment and the provisioning map beside it.
 *
 *   node src/cli/generate-config.ts <deployment.json>
 */

import { readFileSync } from "node:fs";
import { readCarrierMap } from "../adapter/carriers.ts";
import { readDeployment } from "../adapter/deployment.ts";
import { generateConfig } from "../adapter/generator.ts";

const source = process.argv[2];
if (source === undefined) {
  console.error("usage: generate-config <deployment.json>");
  process.exit(2);
}

const deployment = readDeployment(JSON.parse(readFileSync(source, "utf8")));
generateConfig(deployment, readCarrierMap(deployment.carrierMap));
console.log(deployment.configPath);
