/**
 * Which chat reaches the academic pair, and what its agent is told about the two writes. It is read
 * off the generated configuration and the standing instruction, because that is where the boundary
 * is drawn: a capability's tools are its own chat's, and the confirmation is a tap rather than a
 * promise a model makes to itself.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  academicServerName,
  everyAcademicTool,
  promoteTool,
  syncTool,
} from "../src/adapter/academic-tools.ts";
import { agentTools } from "../src/adapter/agent-tools.ts";
import { buildRuntimeConfig } from "../src/adapter/build.ts";
import { chats, everyChat } from "../src/adapter/chats.ts";
import { readDeployment } from "../src/adapter/deployment.ts";
import { generateConfig } from "../src/adapter/generator.ts";
import { chatInstruction } from "../src/adapter/instruction.ts";
import { temporaryMachine, writePrivateSecretsStore } from "./machine.ts";

const machine = temporaryMachine();
const deployment = readDeployment(machine.deployment);
const config = buildRuntimeConfig(deployment, { general: 2, academic: 3, media: 4, system: 5 }, []);

function agent(id: string) {
  return config.agents.list.find((one) => one.id === id)!;
}

describe("reading a deployment", () => {
  /**
   * #196: a `Deployment` handed back to `readDeployment` type-checks, because the parameter is
   * `unknown` and has to be. The academic paths arrive flat and leave nested, so the second pass
   * found none of them and the generator refused a machine that named all six — by listing the six
   * keys to add, which describes the fixture rather than the call that broke it.
   */
  it("refuses one it has already read, rather than dropping what it derived", () => {
    assert.throws(
      () => readDeployment(deployment),
      /already a Deployment/,
      "reading twice silently produces a deployment naming no academic products.",
    );
  });

  it("reads a file that spells out having none, rather than calling it a second read", () => {
    assert.equal(
      readDeployment({ ...machine.deployment, academic: null }).academic?.academicOsRoot,
      machine.deployment.academicOsRoot,
      '`"academic": null` is a machine saying it has no pair, not a Deployment going back in.',
    );
  });

  it("still reads a deployment file's own contents, which is the shape it is for", () => {
    assert.equal(
      readDeployment(machine.deployment).academic?.academicOsRoot,
      machine.deployment.academicOsRoot,
      "the guard is reading the derived field, not the flat one it is derived from.",
    );
  });
});

describe("the connection to the academic desk", () => {
  it("stands one desk on loopback, a port above the lane monitor's", () => {
    const server = (config.mcp.servers as Record<string, { url: string; transport: string }>)[
      academicServerName
    ]!;
    assert.equal(server.url, `http://127.0.0.1:${deployment.academicPort}/mcp`);
    assert.equal(server.transport, "streamable-http");
    assert.equal(deployment.academicPort, 18792);
  });

  it("gives the pair's tools to the Academic chat and to no other", () => {
    for (const tool of everyAcademicTool) {
      assert.ok(agent(chats.academic.id).tools.alsoAllow.includes(tool), tool);
    }
    for (const chat of everyChat) {
      if (chat.id === chats.academic.id) continue;
      for (const tool of everyAcademicTool) {
        assert.ok(!agentTools(chat).includes(tool), `${chat.id} reaches ${tool}`);
      }
    }
  });

  it("refuses to write a configuration for a machine that names no products", () => {
    const bare = temporaryMachine() as { deployment: Record<string, unknown> };
    for (const key of [
      "academicOsRoot",
      "academicOsConfig",
      "academicOsState",
      "ntulearnRoot",
      "ntulearnState",
      "academicState",
    ]) {
      delete bare.deployment[key];
    }
    writePrivateSecretsStore(bare.deployment.secretsStore as string);
    assert.throws(
      () => generateConfig(readDeployment(bare.deployment), { general: 2 }),
      /names no academic products/,
    );
  });

  it("refuses a machine that named one product and not the other", () => {
    assert.throws(
      () => readDeployment({ ...machine.deployment, ntulearnRoot: undefined }),
      /all of academicOsRoot/,
    );
  });
});

describe("what the Academic chat is told about the pair", () => {
  const instruction = chatInstruction(chats.academic);

  it("says Syrax holds neither product's credentials", () => {
    assert.match(instruction, /holds no NTULearn and no Google credential/);
  });

  it("names the two writes, and says each happens only on a tap", () => {
    assert.match(instruction, new RegExp(syncTool));
    assert.match(instruction, new RegExp(promoteTool));
    assert.match(instruction, /each happens only on a tap/);
    assert.match(instruction, /Never work\s+out a value yourself/);
  });

  it("says an expired button is answered rather than worked around", () => {
    assert.match(instruction, /expired means the button has gone stale/);
  });

  it("names what has no tool, so a login is asked for rather than attempted", () => {
    assert.match(instruction, /npm run login/);
    assert.match(instruction, /never offer to do it, and never work around it/);
  });

  it("says none of it to a chat that does not own the pair", () => {
    for (const chat of everyChat) {
      if (chat.id === chats.academic.id) continue;
      assert.doesNotMatch(chatInstruction(chat), /The academic pair/);
    }
  });
});
