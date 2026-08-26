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
  monitorState: "/private/root/lane-monitor",
  monitorWrapperPath: "/private/root/bin/start-monitor.sh",
  searchScopes: { academic: "/private/root/corpus/modules" },
  ownerTelegramUserId: 100000000,
});

const config = buildRuntimeConfig(deployment, { general: 2, academic: 3, media: 4, system: 5 }, []);
const servers = config.mcp.servers as Record<
  string,
  { url: string; transport: string; headers?: Record<string, string> }
>;

function agent(id: string) {
  return config.agents.list.find((one) => one.id === id)!;
}

describe("the connections to the search unit", () => {
  it("gives every chat that searches its own connection to the one resident unit", () => {
    const searchServers = Object.keys(servers).filter((name) => name.startsWith("syrax-search-"));
    assert.deepEqual(searchServers, ["syrax-search-general", "syrax-search-academic"]);
    for (const name of searchServers) {
      assert.equal(servers[name]!.url, "http://127.0.0.1:18790/mcp");
      assert.equal(servers[name]!.transport, "streamable-http");
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
      assert.ok(!agent(chat.id).tools.alsoAllow.some((tool) => tool.startsWith("syrax-search-")));
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

  it("lets a chat that searches record a miss, and gives no other chat the tool", () => {
    assert.ok(agentTools(chats.general).includes("syrax-search-general__capture"));
    assert.ok(agentTools(chats.academic).includes("syrax-search-academic__capture"));
    assert.ok(!agentTools(chats.system).some((tool) => tool.endsWith("__capture")));
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

  /**
   * The same instruction with its wrapping collapsed. What is under test is the sentence, and the
   * sentence is hard-wrapped at whatever column the prose reached — so a `\s+` between two words is
   * a guess about where the break fell today, and editing a clause four words earlier moves it.
   * Three of these have gone red for a reflow rather than for a change in meaning.
   */
  const flowed = instruction.replace(/\s+/g, " ");

  it("names the tools of its own connection and of no other chat's", () => {
    assert.match(instruction, /syrax-search-general__search/);
    assert.doesNotMatch(instruction, /syrax-search-academic/);
  });

  it("answers a confident verdict with the document rather than a description of it", () => {
    assert.match(instruction, /send the document itself, without asking/);
    assert.match(instruction, /syrax-search-general__attach/);
  });

  it("ends a delivery at the tool, so the same file is not handed over twice", () => {
    assert.match(instruction, /That call is the whole delivery/);
    assert.match(instruction, /`NO_REPLY` and nothing else, never a `MEDIA:` line/);
  });

  it("lets the Owner's own wording override the verdict's shape", () => {
    assert.match(instruction, /the Owner's own wording asks for something else, which always wins/);
  });

  it("offers a close call rather than picking from it", () => {
    assert.match(flowed, /Never send one of them instead of asking/);
  });

  it("puts the names in the message and the numbers on the buttons", () => {
    assert.match(flowed, /A `label` is the result's own `position` and never its name/);
    assert.match(
      flowed,
      /Number every line from the `position` the reply gives it and never by counting/,
      "the model numbering its own list is how a tap fetches a name nobody read.",
    );
  });

  /**
   * #194: the wording that replaced it said what to put on a button and never where the buttons go,
   * so a turn composed the runtime's own keyboard shape beside `presentation`, `message` dropped the
   * argument it does not have, and the send still answered `ok`. A shortlist reached the Owner with
   * nothing to tap. The block structure is named because leaving it to be inferred has failed once.
   */
  /**
   * #200: the shape was described in prose and validated as a schema, and the gap was the fields
   * prose leaves implicit. Two models on two providers dropped the same two — `type` on the block
   * and `label` on the buttons — and every close call was refused before it reached the wire.
   *
   * So the instruction shows the call, and this reads that example back as JSON rather than as
   * words. The keys asserted here are the ones `MessagePresentationButtonsBlock` and
   * `MessagePresentationButton` require, which is what the validator was rejecting.
   */
  it("shows the shortlist's call as an example that satisfies the runtime's own schema", () => {
    const example = /```json\n([\s\S]*?)```/.exec(instruction)?.[1];
    assert.ok(example, "the close call has no worked example, so its shape is prose again.");

    const call = JSON.parse(example) as {
      action: string;
      message: string;
      presentation: { blocks: { type: string; buttons?: { label: string; value: string }[] }[] };
    };

    assert.equal(call.action, "send");
    assert.match(
      call.message,
      /^1\. .+\n2\. /,
      "the list is not numbered from one in the message.",
    );
    assert.equal(call.presentation.blocks.length, 1, "a block beside the buttons is dropped.");

    const [block] = call.presentation.blocks;
    assert.equal(block!.type, "buttons");
    assert.ok(block!.buttons?.length, "the buttons block carries no buttons.");
    for (const button of block!.buttons!) {
      assert.equal(
        typeof button.label,
        "string",
        `a button with no label: ${JSON.stringify(button)}`,
      );
      assert.equal(
        typeof button.value,
        "string",
        `a button with no value: ${JSON.stringify(button)}`,
      );
    }
    assert.equal(block!.buttons!.at(-1)!.label, "None of these");
  });

  it("names the tool, the argument and the block, rather than leaving the shape to be guessed", () => {
    assert.match(flowed, /calling `message` in exactly this shape/);
    assert.match(flowed, /Every key above is required and the call is refused without it/);
  });

  /**
   * #198: the runtime discards a `text` block whenever a `message` is present, and refuses a
   * `presentation` carrying no `message` at all. Both were measured against the pinned runtime.
   * A shortlist reached the Owner as ten numbers naming nothing.
   */
  it("keeps the list in the message, where a block beside one would be dropped", () => {
    assert.match(flowed, /\*\*The list is the `message`\*\*/);
    assert.match(flowed, /a `text` block beside a `message` is dropped/);
    assert.match(flowed, /a `presentation` with no `message` is refused outright/);
    assert.doesNotMatch(
      instruction,
      /`text` block holding/,
      "the shape that drops the list is being asked for again.",
    );
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

  it("captures a miss from a reply and never from anything else", () => {
    assert.match(instruction, /syrax-search-general__capture/);
    assert.match(instruction, /pass the `answer` value that search's\s+reply carried/);
    assert.match(instruction, /never capture\s+from a message that is not such a reply/);
  });

  it("asks for nothing to make a capture better, correct path included", () => {
    assert.match(
      instruction,
      /a correct path only if one of the unit's own replies\s+has already handed you it/,
    );
    assert.match(instruction, /Never ask them for anything to make the\s+capture better/);
  });

  it("says none of it to a chat that does not search", () => {
    assert.doesNotMatch(chatInstruction(chats.media), /Finding a document/);
  });
});

describe("what every chat is told about a keyboard", () => {
  it("re-passes it on every edit that means to keep it, in every chat that can put one up", () => {
    for (const chat of everyChat) {
      assert.match(
        chatInstruction(chat),
        /Editing a message that carries buttons drops them unless the edit passes them again/,
        `${chat.id} is not told, and a keyboard it edits disappears without a word.`,
      );
    }
  });
});
