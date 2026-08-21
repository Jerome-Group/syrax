/**
 * Creates the topic that carries each chat the provisioning map does not yet name, and writes the
 * map and the runtime's configuration around it.
 *
 *   node src/cli/provision-chats.ts <deployment.json>
 */

import { readFileSync } from "node:fs";
import { readDeployment } from "../adapter/deployment.ts";
import { ChatSurface } from "../surface/chat-surface.ts";

const source = process.argv[2];
if (source === undefined) {
  console.error("usage: provision-chats <deployment.json>");
  process.exit(2);
}

const deployment = readDeployment(JSON.parse(readFileSync(source, "utf8")));
const provisioned = await ChatSurface.open(deployment).provision();

for (const { chat, id } of provisioned) console.log(`${chat.carrierName}\t${id}`);
if (provisioned.length === 0) console.log("Every chat already has a carrier.");
