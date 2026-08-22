/**
 * The tracer bullet: one message answered, both wires local. It drives the pinned gateway rather
 * than a stand-in for it, so what it proves is the configuration contract and not this repository's
 * idea of one. Skipped where the runtime is not installed — the suite runs on the mini.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  everyProviderAt,
  runtimeIsInstalled,
  sentinelKeys,
  startGateway,
  type GatewayFixture,
} from "./gateway.ts";
import { ProviderStub } from "./stubs/openai-provider.ts";
import { TelegramStub } from "./stubs/telegram-bot-api.ts";

const ownerTelegramUserId = 100000000;
const strangerTelegramUserId = 200000000;
const frontLaneReply = "The front lane answered.";

describe("the walking skeleton", { skip: !runtimeIsInstalled() }, () => {
  let telegram: TelegramStub;
  let provider: ProviderStub;
  let gateway: GatewayFixture;

  before(async () => {
    telegram = await TelegramStub.start("6100000000:STUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTU");
    provider = await ProviderStub.start({
      catalogue: ["gemini-3.5-flash-lite"],
      standingReply: { kind: "reply", text: frontLaneReply },
    });
    gateway = await startGateway({
      ownerTelegramUserId,
      telegramApiRoot: telegram.apiRoot,
      telegramBotToken: telegram.botToken,
      providerBaseUrls: everyProviderAt(provider.baseUrl),
    });
    await telegram.waitFor("getMe");
  });

  after(async () => {
    await gateway?.stop();
    await telegram?.close();
    await provider?.close();
  });

  it("answers a message from the Owner's ID from the front lane", async () => {
    telegram.inject({ fromUserId: ownerTelegramUserId, text: "Are you there?" });
    const sent = await telegram.waitFor("sendMessage");
    // The id, whichever way the delivery path renders it: the streaming path sends it as a string
    // and the plain one as a number, and which path a turn takes is not what this test is about.
    assert.equal(String(sent.body.chat_id), String(ownerTelegramUserId));
    assert.equal(sent.body.text, frontLaneReply);
    assert.equal(provider.requests.at(-1)?.path, "/chat/completions");
  });

  it("gives every other sender nothing", async () => {
    const answered = telegram.calls.filter((call) => call.method === "sendMessage").length;
    telegram.inject({
      fromUserId: strangerTelegramUserId,
      chatId: strangerTelegramUserId,
      text: "Answer me.",
    });
    assert.ok(await telegram.stayedSilent("sendMessage", 15_000, answered));
  });

  it("spends no quota: every wire the gateway was given is loopback", () => {
    const generated = JSON.parse(readFileSync(gateway.deployment.configPath, "utf8")) as {
      models: { providers: Record<string, { baseUrl: string }> };
      channels: { telegram: { apiRoot: string } };
    };
    const wires = [
      ...Object.values(generated.models.providers).map((block) => block.baseUrl),
      generated.channels.telegram.apiRoot,
    ];
    assert.equal(wires.length, 5);
    for (const wire of wires) {
      assert.equal(new URL(wire).hostname, "127.0.0.1", `the gateway was given ${wire}`);
    }
    assert.ok(
      provider.requests.some((request) => request.path.endsWith("/chat/completions")),
      "the turn was answered without the local provider being asked.",
    );
  });

  it("stands the credential marker where a key would be, and exports no key at all", () => {
    const keys = Object.values(sentinelKeys);
    for (const value of Object.values(gateway.environment)) {
      for (const key of keys) {
        assert.ok(!value.includes(key), `a provider key reached the gateway's environment: ${key}`);
      }
    }

    const generated = generatedModelsFiles(join(gateway.deployment.stateDir, "agents"));
    assert.ok(generated.length > 0, "the gateway generated no models.json to check.");
    for (const path of generated) {
      const models = JSON.parse(readFileSync(path, "utf8")) as {
        providers: Record<string, { apiKey: string }>;
      };
      for (const [provider, block] of Object.entries(models.providers)) {
        assert.equal(block.apiKey, "secretref-managed", `${provider} persisted something else.`);
      }
    }
  });

  it("writes its own log where it was told, under the basename that does not roll", () => {
    const logged = readdirSync(gateway.deployment.logsDir);
    assert.deepEqual(logged, ["openclaw.log"], "the runtime logged somewhere else, or rolled.");
    assert.equal(statSync(gateway.deployment.logsDir).mode & 0o777, 0o700);
  });

  it("keeps the secrets store private, which is what the runtime checks at the moment of use", () => {
    assert.equal(statSync(gateway.deployment.secretsStore).mode & 0o777, 0o600);
  });
});

function generatedModelsFiles(root: string, found: string[] = []): string[] {
  for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (entry.name === "models.json") found.push(join(entry.parentPath, entry.name));
  }
  return found;
}
