/**
 * The tracer bullet: one message answered, both wires local. It drives the pinned gateway rather
 * than a stand-in for it, so what it proves is the configuration contract and not this repository's
 * idea of one. Skipped where the runtime is not installed — the suite runs on the mini.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

  it("resolves file-backed credentials only at the provider wire, and persists no key", () => {
    const keys = Object.values(sentinelKeys);
    for (const value of Object.values(gateway.environment)) {
      for (const key of keys) {
        assert.ok(!value.includes(key), `a provider key reached the gateway's environment: ${key}`);
      }
    }

    const generated = generatedModelCatalogs(join(gateway.deployment.stateDir, "agents"));
    const config = JSON.parse(readFileSync(gateway.deployment.configPath, "utf8")) as {
      models: { providers: Record<string, { apiKey: { source: string; id: string } }> };
    };
    assert.deepEqual(
      Object.keys(config.models.providers).sort(),
      Object.keys(everyProviderAt(provider.baseUrl)).sort(),
    );
    for (const [id, block] of Object.entries(config.models.providers)) {
      assert.equal(block.apiKey.source, "file");
      const name = id.replace(/^syrax-/, "");
      assert.equal(block.apiKey.id, `/providers/${name}/apiKey`);
    }
    const completion = provider.requests.findLast((request) =>
      request.path.endsWith("/chat/completions"),
    );
    assert.equal(completion?.authorization, `Bearer ${sentinelKeys.gemini}`);

    // Explicitly configured providers need no plugin catalog. Check every artifact the gateway
    // actually persisted, including SQLite/WAL and logs, rather than requiring a legacy filename.
    const artifacts = [gateway.deployment.configPath];
    for (const root of [
      gateway.deployment.stateDir,
      gateway.deployment.logsDir,
      gateway.deployment.workspace,
    ]) {
      for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
        if (entry.isFile()) artifacts.push(join(entry.parentPath, entry.name));
      }
    }
    assert.ok(artifacts.length > 1, "the gateway persisted no runtime artifacts");
    for (const path of artifacts) {
      const bytes = readFileSync(path);
      for (const key of keys)
        assert.ok(
          !bytes.includes(Buffer.from(key)),
          "a provider key persisted outside its secret store",
        );
    }
    for (const contents of generated) {
      for (const key of keys)
        assert.ok(!contents.includes(key), "a provider key reached a catalog");
      const models = JSON.parse(contents) as {
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

/** The pinned runtime splits provider-owned catalogs into the agent's SQLite cache. */
function generatedModelCatalogs(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
    const path = join(entry.parentPath, entry.name);
    if (entry.name === "models.json") found.push(readFileSync(path, "utf8"));
    if (entry.name !== "openclaw-agent.sqlite") continue;
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      const rows = database
        .prepare("SELECT value_json FROM cache_entries WHERE scope = 'plugin-model-catalog-v1'")
        .all();
      for (const row of rows) found.push(String(row.value_json));
    } finally {
      database.close();
    }
  }
  return found;
}
