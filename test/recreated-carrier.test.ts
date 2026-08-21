/**
 * What the gateway does with a carrier the write path recreated under it. The answer is measured
 * rather than assumed: the running gateway does not pick the rewritten configuration up, so until
 * it loads that file again the new carrier is an unrecognised thread id — answered as General and
 * noted in System, which is ADR-0013's standing rule.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { readCarrierMap } from "../src/adapter/carriers.ts";
import { everyChat } from "../src/adapter/chats.ts";
import { BotApi } from "../src/surface/bot-api.ts";
import { ChatSurface } from "../src/surface/chat-surface.ts";
import { runtimeIsInstalled, startGateway, type GatewayFixture } from "./gateway.ts";
import { ownerTelegramUserId } from "./machine.ts";
import { ProviderStub } from "./stubs/openai-provider.ts";
import { TelegramStub, type OutboundCall } from "./stubs/telegram-bot-api.ts";

const answer = "Answered.";
const isAnswer = (call: OutboundCall) => call.body.text === answer;

describe("a recreated carrier", { skip: !runtimeIsInstalled() }, () => {
  let telegram: TelegramStub;
  let provider: ProviderStub;
  let gateway: GatewayFixture;
  const carriers: Record<string, number> = {};

  before(async () => {
    telegram = await TelegramStub.start("6100000000:STUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTU");
    for (const chat of everyChat) carriers[chat.id] = telegram.createTopic();
    provider = await ProviderStub.start({
      catalogue: ["gemini-3.5-flash-lite"],
      standingReply: { kind: "reply", text: answer },
    });
    gateway = await startGateway({
      ownerTelegramUserId,
      telegramApiRoot: telegram.apiRoot,
      telegramBotToken: telegram.botToken,
      providerBaseUrls: {
        "syrax-gemini": provider.baseUrl,
        "syrax-mistral": provider.baseUrl,
        "syrax-groq": provider.baseUrl,
      },
      carriers,
    });
    await telegram.waitFor("getMe");
  });

  after(async () => {
    await gateway?.stop();
    await telegram?.close();
    await provider?.close();
  });

  it("routes to its own agent from the next configuration load, and to General before it", async () => {
    telegram.clearTopic(carriers.media!);
    const surface = new ChatSurface(
      gateway.deployment,
      new BotApi(gateway.deployment.telegramApiRoot, telegram.botToken),
      readCarrierMap(gateway.deployment.carrierMap),
    );

    const [recreated] = await surface.post("media", "The film is downloading.");
    const configured = JSON.parse(readFileSync(gateway.deployment.configPath, "utf8")) as {
      channels: { telegram: { direct: Record<string, { topics: Record<string, unknown> }> } };
    };
    assert.deepEqual(
      configured.channels.telegram.direct[String(ownerTelegramUserId)]!.topics[
        String(recreated!.id)
      ],
      { agentId: "media" },
      "the file the next load reads does not route the new carrier.",
    );

    const since = telegram.matching("sendMessage", isAnswer).length;
    telegram.inject({
      fromUserId: ownerTelegramUserId,
      text: "What is downloading?",
      messageThreadId: recreated!.id,
    });
    await telegram.waitFor("sendMessage", isAnswer, 60_000, since);
    assert.equal(
      /agent=(\w+)/.exec(JSON.stringify(provider.requests.at(-1)?.body))?.[1],
      "general",
      "the running gateway picked the rewritten configuration up; the announcement now over-warns.",
    );
  });

  it("is announced in System, naming what the Owner has to do about it", async () => {
    const announcement = String(
      telegram
        .matching("sendMessage", (call) => call.body.message_thread_id === carriers.system)
        .at(-1)?.body.text,
    );

    assert.match(announcement, /Media came back empty on carrier \d+/);
    assert.match(announcement, /answered as General/);
    assert.match(announcement, /Seerr/);
  });
});
