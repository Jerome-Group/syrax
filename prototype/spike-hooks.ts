/** Spike: can a plugin hook cancel the runtime's model-fallback notice? */
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

const pluginDir = process.argv[2];

const telegram = await TelegramStub.start("6100000000:STUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTU");
const carrier = telegram.createTopic();
const provider = await ProviderStub.start({
  catalogue: ["gemini-3.5-flash-lite", "ministral-3b-latest"],
  standingReply: { kind: "reply", text: "Answered." },
});
provider.scriptModel("gemini-3.5-flash-lite", { kind: "silence" });
provider.scriptModel("ministral-3b-latest", { kind: "reply", text: "The next rung answered." });

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

if (pluginDir !== undefined) {
  const config = JSON.parse(readFileSync(deployment.configPath, "utf8")) as Record<string, unknown>;
  config.plugins = {
    load: { paths: [pluginDir] },
    entries: { "syrax-hush": { enabled: true } },
  };
  writeFileSync(deployment.configPath, `${JSON.stringify(config, null, 2)}\n`);
}

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
telegram.inject({ fromUserId: ownerTelegramUserId, text: "Are you there?", messageThreadId: carrier });
await telegram.waitFor("sendMessage", (call) => call.body.text === "The next rung answered.", 150_000);
await new Promise((resolve) => setTimeout(resolve, 3_000));

console.log("=== plugin:", pluginDir ?? "none", "===");
for (const call of telegram.matching("sendMessage")) console.log("sendMessage:", call.body.text);
console.log("hush lines:", readFileSync(log, "utf8").split("\n").filter((l) => l.includes("[hush]")).length);
console.log("plugin load errors:", readFileSync(log, "utf8").split("\n").filter((l) => /plugin/i.test(l) && /error|fail|invalid/i.test(l)).slice(0, 3));
gateway.kill("SIGKILL");
await telegram.close();
await provider.close();
process.exit(0);
