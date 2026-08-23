/**
 * Which chat reaches the corpus, how far, and what each one's agent is allowed to call. All of it
 * is read off the generated configuration, because that is where the boundary is drawn: a scope the
 * model could name is a scope the model could widen.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentTools, delegationTools } from "../src/adapter/agent-tools.ts";
import { buildRuntimeConfig } from "../src/adapter/build.ts";
import { chats, everyChat } from "../src/adapter/chats.ts";
import { readDeployment } from "../src/adapter/deployment.ts";
import { generateConfig } from "../src/adapter/generator.ts";
import { chatInstruction } from "../src/adapter/instruction.ts";
import { temporaryMachine, writePrivateSecretsStore } from "./machine.ts";

const deployment = readDeployment({
  runtimeRoot: "/private/root/runtime",
  configPath: "/private/root/openclaw.json",
  stateDir: "/private/root/state",
  workspace: "/private/root/workspace",
  secretsStore: "/private/root/secrets/syrax.json",
  carrierMap: "/private/root/state/carriers.json",
  logsDir: "/private/root/logs",
  wrapperPath: "/private/root/bin/start-gateway.sh",
  searchRoot: "/private/root/search-env",
  searchIndex: "/private/root/search-index",
  searchWrapperPath: "/private/root/bin/start-search.sh",
  searchScopes: { academic: "/private/root/corpus/modules" },
  ownerTelegramUserId: 100000000,
});

const config = buildRuntimeConfig(deployment, { general: 2, academic: 3, media: 4, system: 5 });
const servers = config.mcp.servers as Record<
  string,
  { url: string; transport: string; headers?: Record<string, string> }
>;

function agent(id: string) {
  return config.agents.list.find((one) => one.id === id)!;
}

describe("the connections to the search unit", () => {
  it("gives every chat that searches its own connection to the one resident unit", () => {
    assert.deepEqual(Object.keys(servers), ["syrax-search-general", "syrax-search-academic"]);
    for (const server of Object.values(servers)) {
      assert.equal(server.url, "http://127.0.0.1:18790/mcp");
      assert.equal(server.transport, "streamable-http");
    }
  });

  it("carries a chat's scope on its own connection, and General's reaches everything", () => {
    assert.deepEqual(servers["syrax-search-academic"]!.headers, { "X-Syrax-Scope": "academic" });
    assert.equal(servers["syrax-search-general"]!.headers, undefined);
  });

  it("gives each searching agent its own server's tools and no other chat's", () => {
    for (const chat of everyChat.filter((one) => one.searches !== undefined)) {
      const allowed = agent(chat.id).tools.alsoAllow;
      assert.ok(allowed.includes(`syrax-search-${chat.id}__search`));
      for (const other of everyChat.filter((one) => one.id !== chat.id)) {
        assert.ok(
          !allowed.some((tool) => tool.startsWith(`syrax-search-${other.id}__`)),
          `${chat.id} can call ${other.id}'s connection.`,
        );
      }
    }
  });

  it("leaves the chats that own a capability off the corpus entirely", () => {
    for (const chat of [chats.media, chats.system]) {
      assert.deepEqual(agent(chat.id).tools.alsoAllow, delegationTools);
    }
  });

  it("keeps the delegation tools on every agent, since a per-agent list replaces the standing one", () => {
    for (const chat of everyChat) {
      for (const tool of delegationTools) {
        assert.ok(
          agent(chat.id).tools.alsoAllow.includes(tool),
          `${chat.id} cannot delegate, so its front lane answers everything itself.`,
        );
      }
    }
  });

  it("lets a chat that searches post the file and the keyboard a search answers with", () => {
    assert.ok(agentTools(chats.general).includes("message"));
    assert.ok(!agentTools(chats.media).includes("message"));
  });

  it("refuses to write a configuration whose scope no machine gave a root", () => {
    const machine = temporaryMachine({ searchScopes: {} });
    writePrivateSecretsStore(machine.deployment.secretsStore);
    assert.throws(
      () => generateConfig(readDeployment(machine.deployment), { general: 2 }),
      /searchScopes names no root for academic/,
    );
  });
});

describe("what a chat that searches is told", () => {
  const instruction = chatInstruction(chats.general);

  it("names the tools of its own connection and of no other chat's", () => {
    assert.match(instruction, /syrax-search-general__search/);
    assert.doesNotMatch(instruction, /syrax-search-academic/);
  });

  it("answers a confident verdict with the document rather than a description of it", () => {
    assert.match(instruction, /send the document itself, without asking/);
    assert.match(instruction, /syrax-search-general__attach/);
  });

  it("lets the Owner's own wording override the verdict's shape", () => {
    assert.match(instruction, /the Owner's own wording asks for something else, which always wins/);
  });

  it("offers a close call rather than picking from it", () => {
    assert.match(instruction, /None of these/);
    assert.match(instruction, /Never send one of them instead of asking/);
  });

  it("delivers an empty verdict as nothing here, never as the least-bad match", () => {
    assert.match(instruction, /say there is nothing here/);
    assert.match(instruction, /Never offer the closest thing you found/);
  });

  it("resolves a tap through the unit that minted it, and never by working it out", () => {
    assert.match(instruction, /callback_data: <value>/);
    assert.match(instruction, /syrax-search-general__choose/);
    assert.match(instruction, /Never\s+work out what was tapped yourself/);
  });

  it("says an expired shortlist has expired rather than acting on it", () => {
    assert.match(instruction, /on \*expired\* tell them the shortlist has expired/);
  });

  it("re-passes a keyboard on every edit that means to keep it", () => {
    assert.match(instruction, /Editing a message that carries buttons drops them unless the edit/);
  });

  it("says none of it to a chat that does not search", () => {
    assert.doesNotMatch(chatInstruction(chats.media), /Finding a document/);
  });
});
