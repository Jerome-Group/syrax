/**
 * What the gateway does with a carrier the write path recreated under it. The answer is measured
 * rather than assumed: the rewritten `channels` block is landed by a channel reload the runtime
 * defers until the turns in flight drain (ADR-0021), so the first message can still meet the old
 * routing — answered as General, ADR-0013's standing rule for an unrecognised thread id — and the
 * next one reaches the chat's own agent.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { readCarrierMap } from "../src/adapter/carriers.ts";
import { BotApi } from "../src/surface/bot-api.ts";
import { ChatSurface } from "../src/surface/chat-surface.ts";
import { runtimeIsInstalled, standSyrax, type SyraxFixture } from "./gateway.ts";
import { ownerTelegramUserId } from "./machine.ts";
import type { OutboundCall } from "./stubs/telegram-bot-api.ts";

const answer = "Answered.";
const isAnswer = (call: OutboundCall) => call.body.text === answer;

describe("a recreated carrier", { skip: !runtimeIsInstalled() }, () => {
  let syrax: SyraxFixture;

  before(async () => {
    syrax = await standSyrax({ standingReply: answer });
  });

  after(async () => {
    await syrax?.stop();
  });

  it("reaches its own agent without a restart, once the turns in flight have drained", async () => {
    // One turn first: the config watcher is the last thing the gateway starts, after it reports
    // itself ready, and a rewrite that beats it is never seen at all (ADR-0021).
    const opening = syrax.telegram.matching("sendMessage", isAnswer).length;
    syrax.telegram.inject({ fromUserId: ownerTelegramUserId, text: "Are you there?" });
    await syrax.telegram.waitFor("sendMessage", isAnswer, 60_000, opening);

    syrax.telegram.clearTopic(syrax.carriers.media!);
    const surface = new ChatSurface(
      syrax.gateway.deployment,
      new BotApi(syrax.gateway.deployment.telegramApiRoot, syrax.telegram.botToken),
      readCarrierMap(syrax.gateway.deployment.carrierMap),
    );

    const [recreated] = await surface.post("media", "The film is downloading.");
    const configured = JSON.parse(readFileSync(syrax.gateway.deployment.configPath, "utf8")) as {
      channels: { telegram: { direct: Record<string, { topics: Record<string, unknown> }> } };
    };
    assert.deepEqual(
      configured.channels.telegram.direct[String(ownerTelegramUserId)]!.topics[
        String(recreated!.id)
      ],
      { agentId: "media" },
      "the file the next load reads does not route the new carrier.",
    );

    const answering: string[] = [];
    for (let attempt = 1; attempt <= 4 && answering.at(-1) !== "media"; attempt++) {
      const since = syrax.telegram.matching("sendMessage", isAnswer).length;
      syrax.telegram.inject({
        fromUserId: ownerTelegramUserId,
        text: `What is downloading? (${attempt})`,
        messageThreadId: recreated!.id,
      });
      await syrax.telegram.waitFor("sendMessage", isAnswer, 60_000, since);
      answering.push(
        /agent=(\w+)/.exec(JSON.stringify(syrax.provider.requests.at(-1)?.body))?.[1] ?? "",
      );
      if (answering.at(-1) !== "media") await new Promise((wait) => setTimeout(wait, 2000));
    }

    assert.equal(answering.at(-1), "media", `the new carrier never reached Media: ${answering}`);
    assert.ok(answering.length <= 3, `it took ${answering.length} turns: ${answering}`);
  });

  it("is announced in System, naming what the Owner has to do about it", async () => {
    const announcement = String(
      syrax.telegram
        .matching(
          "sendMessage",
          (call: OutboundCall) => call.body.message_thread_id === syrax.carriers.system,
        )
        .at(-1)?.body.text,
    );

    assert.match(announcement, /Media came back empty on carrier \d+/);
    assert.match(announcement, /may be answered as General/);
    assert.match(announcement, /Seerr/);
  });
});
