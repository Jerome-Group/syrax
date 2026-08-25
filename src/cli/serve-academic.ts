/**
 * Runs the academic desk: the pair's tools over MCP on loopback, and the morning brief's poke.
 *
 *   node src/cli/serve-academic.ts <deployment.json>
 *
 * The wrapper the LaunchAgent runs execs this. Nothing is scheduled inside it — every wall-clock job
 * in this system is a launchd calendar entry poking a running unit (ADR-0005).
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readDeployment } from "../adapter/deployment.ts";
import { serveAcademicDesk } from "../academic/desk.ts";

const source = process.argv[2];
if (source === undefined) {
  console.error("usage: serve-academic <deployment.json>");
  process.exit(2);
}

const deployment = readDeployment(JSON.parse(await readFile(resolve(source), "utf8")));
const { port } = await serveAcademicDesk(deployment);
console.error(`syrax academic desk: the pair is on 127.0.0.1:${port}`);
