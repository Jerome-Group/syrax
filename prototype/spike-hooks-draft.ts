/** Spike: which hooks see the progress draft, and can any of them reach its deletion? */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readDeployment } from "./src/adapter/deployment.ts";
import { generateConfig } from "./src/adapter/generator.ts";
import { writeCarrierMap } from "./src/adapter/carriers.ts";
import { everyProviderAt, runtimeEntrypoint, runtimeRoot, writeSecretsStore } from "./test/gateway.ts";
import { ownerTelegramUserId, temporaryMachine } from "./test/machine.ts";
import { ProviderStub } from "./test/stubs/openai-provider.ts";
import { TelegramStub } from "./test/stubs/telegram-bot-api.ts";

const pluginFile = process.argv[2]!;
const answer = "The worker's own words.";

const telegram = await TelegramStub.start("6100000000:STUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTU");
const carrier = telegram.createTopic();
const provider = await ProviderStub.start({
  catalogue: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
  standingReply: { kind: "reply", text: "Answered." },
});
provider.scriptModel(
  "gemini-3.5-flash-lite",
  { kind: "toolCall", name: "sessions_spawn", arguments: { task: "Read the long thing." } },
  { kind: "toolCall", name: "sessions_yield", arguments: {}, afterMs: 8_000 },
  { kind: "reply", text: answer },
);
provider.scriptModel("gemini-3.1-flash-lite", { kind: "reply", text: answer, afterMs: 25_000 });

const machine = temporaryMachine({ runtimeRoot });
const deployment = readDeployment({
  ...machine.deployment,
  secretsStore: writeSecretsStore(machine.deployment.secretsStore, telegram.botToken),
  ownerTelegramUserId,
  gatewayPort: 30000 + Math.floor(Number(process.pid) % 20000),
  telegramApiRoot: telegram.apiRoot,
  providerBaseUrls: everyProviderAt(provider.baseUrl),
});
writeCarrierMap(deployment.carrierMap, { general: carrier });
generateConfig(deployment, { general: carrier });
const config = JSON.parse(readFileSync(deployment.configPath, "utf8")) as Record<string, unknown>;
config.plugins = { load: { paths: [pluginFile] }, entries: { "syrax-hush": { enabled: true } } };
writeFileSync(deployment.configPath, `${JSON.stringify(config, null, 2)}\n`);

const log = join(machine.root, "gateway.log");
const gateway = spawn(process.execPath, [runtimeEntrypoint(), "gateway"], {
  env: {
    PATH: process.env.PATH ?? "",
    HOME: machine.root,
    OPENCLAW_CONFIG_PATH: deployment.configPath,
    OPENCLAW_STATE_DIR: deployment.stateDir,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
gateway.stdout?.on("data", (chunk: Buffer) => writeFileSync(log, chunk, { flag: "a" }));
gateway.stderr?.on("data", (chunk: Buffer) => writeFileSync(log, chunk, { flag: "a" }));

await telegram.waitFor("getMe");
telegram.inject({ fromUserId: ownerTelegramUserId, text: "Read it.", messageThreadId: carrier });
await telegram.waitFor("sendMessage", (call) => call.body.text === answer, 150_000);
await new Promise((resolve) => setTimeout(resolve, 3_000));

console.log("=== telegram ===");
for (const call of telegram.calls) {
  if (["sendMessage", "editMessageText", "deleteMessage"].includes(call.method)) {
    console.log(call.method, String(call.body.text ?? call.body.message_id).slice(0, 70));
  }
}
console.log("=== hooks that fired ===");
for (const line of readFileSync(log, "utf8").split("\n").filter((l) => l.includes("[hush]"))) {
  console.log(line.slice(line.indexOf("[hush]")));
}
gateway.kill("SIGKILL");
await telegram.close();
await provider.close();
process.exit(0);
