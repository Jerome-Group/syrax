/**
 * The four chats at both wires: which agent a message reached, and where the answer came back.
 * The agent is read off the prompt the provider was handed rather than out of the runtime, so what
 * is proved is the routing the configuration asks for and not this repository's idea of it.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { chats, everyChat } from "../src/adapter/chats.ts";
import { runtimeIsInstalled, startGateway, type GatewayFixture } from "./gateway.ts";
import { ownerTelegramUserId } from "./machine.ts";
import { ProviderStub } from "./stubs/openai-provider.ts";
import { TelegramStub, type OutboundCall } from "./stubs/telegram-bot-api.ts";

const answer = "Answered.";
const carriers: Record<string, number> = {};

describe("the four chats", { skip: !runtimeIsInstalled() }, () => {
  let telegram: TelegramStub;
  let provider: ProviderStub;
  let gateway: GatewayFixture;

  before(async () => {
    telegram = await TelegramStub.start("6100000000:STUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTU");
    for (const subject of everyChat) carriers[subject.id] = telegram.createTopic();
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

  /** Injects one message and returns the send that answered it, with the prompt that produced it. */
  async function ask(
    text: string,
    carrier?: number,
  ): Promise<{ sent: OutboundCall; prompt: string }> {
    const isAnswer = (call: OutboundCall) => call.body.text === answer;
    const answered = telegram.matching("sendMessage", isAnswer).length;
    telegram.inject({ fromUserId: ownerTelegramUserId, text, messageThreadId: carrier });
    const sent = await telegram.waitFor("sendMessage", isAnswer, 60_000, answered);
    return { sent, prompt: JSON.stringify(provider.requests.at(-1)?.body) };
  }

  function answeringAgent(prompt: string): string {
    return /agent=(\w+)/.exec(prompt)?.[1] ?? "none";
  }

  it("answers a thread-less root message as General, and never drops it", async () => {
    const { sent, prompt } = await ask("Are you there?");

    assert.equal(answeringAgent(prompt), "general");
    assert.equal(sent.body.message_thread_id, undefined, "the answer left the root.");
  });

  for (const subject of everyChat) {
    it(`answers the ${subject.carrierName} carrier as the ${subject.id} agent`, async () => {
      const { sent, prompt } = await ask("What is the state of things?", carriers[subject.id]);

      assert.equal(answeringAgent(prompt), subject.id);
      assert.equal(sent.body.message_thread_id, carriers[subject.id]);
      assert.match(prompt, new RegExp(`${subject.carrierName}\\*\\* chat`));
    });
  }

  it("redirects a question a chat does not own, rather than reaching across to answer it", async () => {
    const intoMedia = (call: OutboundCall) => call.body.message_thread_id === carriers.media;
    const wroteToMedia = telegram.matching("sendMessage", intoMedia).length;

    const { sent, prompt } = await ask("Download the new Dune film.", carriers.academic);

    assert.equal(answeringAgent(prompt), "academic");
    assert.match(prompt, /redirected, never answered/);
    assert.match(prompt, new RegExp(`\\*\\*Media\\*\\* owns ${chats.media.owns}`));
    assert.equal(sent.body.message_thread_id, carriers.academic);
    assert.equal(
      telegram.matching("sendMessage", intoMedia).length,
      wroteToMedia,
      "the chat that does not own the question wrote into the chat that does.",
    );
  });

  it("gives each chat its own session, so one chat's context is never another's", async () => {
    const sessions = new Set<string>();
    for (const subject of everyChat) {
      const { prompt } = await ask("What is the state of things?", carriers[subject.id]);
      sessions.add(/session=(\S+)/.exec(prompt)?.[1] ?? subject.id);
    }
    assert.equal(sessions.size, everyChat.length);
  });
});
