import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRuntimeConfig } from "../src/adapter/build.ts";
import { readDeployment } from "../src/adapter/deployment.ts";
import { standingInstruction } from "../src/adapter/general-agent.ts";

const deployment = readDeployment({
  runtimeRoot: "/private/root/runtime",
  configPath: "/private/root/openclaw.json",
  stateDir: "/private/root/state",
  workspace: "/private/root/workspace",
  secretsStore: "/private/root/secrets/syrax.json",
  ownerTelegramUserId: 100000000,
});

const config = buildRuntimeConfig(deployment);

function everyStringIn(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") found.push(value);
  else if (Array.isArray(value)) for (const item of value) everyStringIn(item, found);
  else if (value && typeof value === "object")
    for (const item of Object.values(value)) everyStringIn(item, found);
  return found;
}

function keyExistsAnywhere(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => keyExistsAnywhere(item, key));
  if (value && typeof value === "object") {
    if (key in value) return true;
    return Object.values(value).some((item) => keyExistsAnywhere(item, key));
  }
  return false;
}

describe("the generated runtime configuration", () => {
  it("states every standing line rather than inheriting it", () => {
    assert.deepEqual(config.agents.defaults.skills, []);
    assert.equal(config.agents.defaults.workspace, deployment.workspace);
    assert.equal(config.agents.defaults.skipBootstrap, true);
    assert.equal(config.agents.defaults.blockStreamingDefault, "off");
    assert.equal(config.agents.defaults.typingMode, "instant");
    assert.equal(config.tools.profile, "minimal");
  });

  it("leaves requireTopic unset, so a thread-less root message still binds to General", () => {
    assert.equal(keyExistsAnywhere(config, "requireTopic"), false);
  });

  it("walks the front chain in ADR-0016's order", () => {
    assert.equal(config.agents.defaults.model.primary, "syrax-gemini/gemini-3.5-flash-lite");
    assert.deepEqual(config.agents.defaults.model.fallbacks, [
      "syrax-mistral/ministral-3b-latest",
      "syrax-groq/openai/gpt-oss-120b",
    ]);
  });

  it("answers one Telegram account and fails closed on every other", () => {
    assert.equal(config.channels.telegram.dmPolicy, "allowlist");
    assert.deepEqual(config.channels.telegram.allowFrom, ["100000000"]);
    assert.equal(config.channels.telegram.groupPolicy, "disabled");
  });

  it("carries a file-backed ref wherever a credential would be, and no key anywhere", () => {
    for (const provider of Object.values(config.models.providers)) {
      assert.deepEqual(provider.apiKey.source, "file");
    }
    assert.equal(config.channels.telegram.botToken.source, "file");
    assert.equal(config.gateway.auth.token.source, "file");

    const secretShaped = /^(?:sk-|xai-|gsk_|AIza|\d{8,}:[\w-]{30,})/;
    for (const value of everyStringIn(config)) {
      assert.ok(!secretShaped.test(value), `a credential-shaped string is in the config: ${value}`);
    }
  });

  it("tells the front lane not to guess, without naming the file that says so", () => {
    assert.match(standingInstruction, /Never state a fact you have not verified/);
    assert.match(standingInstruction, /Never\nmention this file/);
  });
});
