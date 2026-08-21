import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRuntimeConfig } from "../src/adapter/build.ts";
import { readDeployment } from "../src/adapter/deployment.ts";
import { chatInstruction, chats } from "../src/adapter/chats.ts";

const deployment = readDeployment({
  runtimeRoot: "/private/root/runtime",
  configPath: "/private/root/openclaw.json",
  stateDir: "/private/root/state",
  workspace: "/private/root/workspace",
  secretsStore: "/private/root/secrets/syrax.json",
  carrierMap: "/private/root/state/carriers.json",
  logsDir: "/private/root/logs",
  wrapperPath: "/private/root/bin/start-gateway.sh",
  ownerTelegramUserId: 100000000,
});

/** What the wizard provisioned: one topic per chat, named in the map and never indexed. */
const carriers = { general: 2, academic: 3, media: 4, system: 5 } as const;

const config = buildRuntimeConfig(deployment, carriers);

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

  it("states the log's fixed basename, its size bound and its redaction", () => {
    assert.equal(config.logging.file, "/private/root/logs/openclaw.log");
    assert.doesNotMatch(config.logging.file, /\d{4}-\d{2}-\d{2}/, "a dated basename rolls.");
    assert.equal(config.logging.maxFileBytes, 26214400);
    assert.equal(config.logging.redactSensitive, "tools");
  });

  it("names the port it listens on, so a second gateway collides rather than drifting", () => {
    assert.equal(config.gateway.port, 18789);
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

  it("tells every agent not to guess, without naming the file that says so", () => {
    for (const subject of chats) {
      const instruction = chatInstruction(subject);
      assert.match(instruction, /Never state a fact you have not verified/);
      assert.match(instruction, /Never mention this file/);
    }
  });
});

describe("the four chats", () => {
  it("gives each chat an agent of its own, with General the default", () => {
    assert.deepEqual(
      config.agents.list.map((agent) => agent.id),
      ["general", "academic", "media", "system"],
    );
    const defaulted = config.agents.list.filter((agent) => "default" in agent);
    assert.deepEqual(
      defaulted.map((agent) => agent.id),
      ["general"],
    );
  });

  it("binds each carrier to its own agent, by name from the provisioning map", () => {
    const topics = config.channels.telegram.direct["100000000"]!.topics;
    assert.deepEqual(topics, {
      "2": { agentId: "general" },
      "3": { agentId: "academic" },
      "4": { agentId: "media" },
      "5": { agentId: "system" },
    });
  });

  it("routes no topic at all where the map was lost, leaving the default agent to answer", () => {
    const lost = buildRuntimeConfig(deployment, {});
    assert.deepEqual(lost.channels.telegram.direct["100000000"]!.topics, {});
  });

  it("separates the agents' workspaces, so each carries its own boundary", () => {
    const workspaces = config.agents.list.map((agent) => agent.workspace);
    assert.deepEqual(new Set(workspaces).size, workspaces.length);
    for (const workspace of workspaces) {
      assert.ok(workspace.startsWith(`${deployment.workspace}/`), workspace);
    }
  });

  it("tells each agent to redirect rather than reach across, and names who owns what", () => {
    for (const subject of chats) {
      const instruction = chatInstruction(subject);
      assert.match(instruction, /redirected, never answered/);
      assert.match(instruction, /never reach into another chat's tools or corpus/);
      for (const other of chats) {
        assert.match(instruction, new RegExp(other.carrierName), `${subject.id} omits ${other.id}`);
      }
    }
  });
});
