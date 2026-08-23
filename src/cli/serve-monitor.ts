/**
 * Runs the lane monitor: the hatch over MCP on loopback, and the counters behind it.
 *
 *   node src/cli/serve-monitor.ts <deployment.json>
 *
 * The wrapper the LaunchAgent runs execs this. Nothing is scheduled inside it — every wall-clock
 * job in this system is a launchd calendar entry poking a running unit (ADR-0005).
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readDeployment } from "../adapter/deployment.ts";
import { serveLaneMonitor } from "../monitor/lane-monitor.ts";

const source = process.argv[2];
if (source === undefined) {
  console.error("usage: serve-monitor <deployment.json>");
  process.exit(2);
}

const deployment = readDeployment(JSON.parse(await readFile(resolve(source), "utf8")));
const { port } = await serveLaneMonitor(deployment);
console.error(`syrax lane monitor: the hatch is on 127.0.0.1:${port}`);
