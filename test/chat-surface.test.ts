/**
 * The write path at the Telegram wire: what crossed it when a carrier was there, and what crossed
 * it when the Owner had cleared one. Nothing here starts a gateway — these are Syrax's own writes,
 * which is where a cleared carrier is discovered at all.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { readCarrierMap, type CarrierMap } from "../src/adapter/carriers.ts";
import { readDeployment, type Deployment } from "../src/adapter/deployment.ts";
import { generateConfig } from "../src/adapter/generator.ts";
import { BotApi, TelegramApiError } from "../src/surface/bot-api.ts";
import { ChatSurface } from "../src/surface/chat-surface.ts";
import { ownerTelegramUserId, temporaryMachine } from "./machine.ts";
import { writeSecretsStore } from "./gateway.ts";
import { TelegramStub } from "./stubs/telegram-bot-api.ts";

const botToken = "6100000000:STUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTU";

describe("the write path", () => {
  let telegram: TelegramStub;
  let deployment: Deployment;
  let carriers: Record<string, number>;

  before(async () => {
    telegram = await TelegramStub.start(botToken);
  });

  after(async () => {
    await telegram?.close();
  });

  beforeEach(() => {
    const machine = temporaryMachine();
    deployment = readDeployment({
      ...machine.deployment,
      secretsStore: writeSecretsStore(machine.deployment.secretsStore as string, botToken),
      telegramApiRoot: telegram.apiRoot,
    });
    carriers = {
      general: telegram.createTopic(),
      academic: telegram.createTopic(),
      media: telegram.createTopic(),
      system: telegram.createTopic(),
    };
    generateConfig(deployment, carriers as CarrierMap);
  });

  function surface(): ChatSurface {
    return new ChatSurface(
      deployment,
      new BotApi(deployment.telegramApiRoot, botToken),
      carriers as CarrierMap,
    );
  }

  function sends(): { chat_id: unknown; text: unknown; message_thread_id?: unknown }[] {
    return telegram.calls
      .filter((call) => call.method === "sendMessage")
      .map((call) => call.body as { chat_id: unknown; text: unknown });
  }

  it("posts into the carrier the map names, and creates nothing", async () => {
    const before = telegram.calls.length;
    const recreations = await surface().post("academic", "Two things are due tomorrow.");

    assert.deepEqual(recreations, []);
    const crossed = telegram.calls.slice(before);
    assert.deepEqual(
      crossed.map((call) => call.method),
      ["sendMessage"],
    );
    assert.equal(crossed[0]!.body.message_thread_id, carriers.academic);
    assert.equal(crossed[0]!.body.chat_id, ownerTelegramUserId);
  });

  it("recreates a cleared carrier by name, retries the send, and announces it in System", async () => {
    telegram.clearTopic(carriers.media!);
    const before = telegram.calls.length;

    const recreations = await surface().post("media", "The film is downloading.");

    assert.equal(recreations.length, 1);
    const recreated = recreations[0]!.id;
    assert.notEqual(recreated, carriers.media);

    const crossed = telegram.calls.slice(before);
    assert.deepEqual(
      crossed.map((call) => call.method),
      ["sendMessage", "createForumTopic", "sendMessage", "sendMessage"],
    );
    assert.equal(crossed[1]!.body.name, "Media");
    assert.equal(crossed[2]!.body.message_thread_id, recreated);
    assert.equal(crossed[2]!.body.text, "The film is downloading.");

    const announcement = crossed[3]!.body;
    assert.equal(announcement.message_thread_id, carriers.system);
    assert.match(String(announcement.text), new RegExp(`carrier ${recreated}`));
  });

  it("names the consequence of a Media recreation, which is Seerr's and not Syrax's to fix", async () => {
    telegram.clearTopic(carriers.media!);
    await surface().post("media", "The film is downloading.");
    const announcement = String(sends().at(-1)!.text);

    assert.match(announcement, /Seerr/);
    assert.match(announcement, /re-point it/);
  });

  it("says nothing about a chat whose carrier was still there", async () => {
    const before = sends().length;
    await surface().post("system", "Groq stood down until 00:00 UTC.");
    assert.equal(sends().length, before + 1);
  });

  it("writes the new carrier into the map, so the next run does not recreate it again", async () => {
    telegram.clearTopic(carriers.academic!);
    const [recreation] = await surface().post("academic", "Nothing is due today.");

    assert.deepEqual(readCarrierMap(deployment.carrierMap), {
      ...carriers,
      academic: recreation!.id,
    });
  });

  it("regenerates the configuration, so the new carrier routes to its own agent", async () => {
    telegram.clearTopic(carriers.academic!);
    const [recreation] = await surface().post("academic", "Nothing is due today.");

    const routed = JSON.parse(readFileSync(deployment.configPath, "utf8")) as {
      channels: { telegram: { direct: Record<string, { topics: Record<string, unknown> }> } };
    };
    const topics = routed.channels.telegram.direct[String(ownerTelegramUserId)]!.topics;
    assert.deepEqual(topics[String(recreation!.id)], { agentId: "academic" });
    assert.equal(topics[String(carriers.academic)], undefined);
  });

  it("recreates on the first write where the map was lost, rather than at startup", async () => {
    carriers = { system: carriers.system! };
    const before = telegram.calls.length;

    const [recreation] = await surface().post("general", "Here is the file.");

    assert.equal(recreation!.chat.id, "general");
    // No send is attempted first: there is no carrier to attempt it against.
    assert.deepEqual(
      telegram.calls.slice(before).map((call) => call.method),
      ["createForumTopic", "sendMessage", "sendMessage"],
    );
  });

  it("announces System's own recreation, in the System chat it just recreated", async () => {
    telegram.clearTopic(carriers.system!);
    const recreations = await surface().post("system", "Groq stood down until 00:00 UTC.");

    assert.deepEqual(
      recreations.map((each) => each.chat.id),
      ["system"],
    );
    const announcement = sends().at(-1)!;
    assert.equal(announcement.message_thread_id, recreations[0]!.id);
    assert.match(String(announcement.text), /System came back empty/);
  });

  it("provisions only the chats the map does not name, and posts nothing", async () => {
    carriers = { system: carriers.system! };
    const before = telegram.calls.length;

    const provisioned = await surface().provision();

    assert.deepEqual(
      provisioned.map((each) => each.chat.id),
      ["general", "academic", "media"],
    );
    assert.deepEqual(
      telegram.calls.slice(before).map((call) => call.method),
      ["createForumTopic", "createForumTopic", "createForumTopic"],
    );
    assert.deepEqual(Object.keys(readCarrierMap(deployment.carrierMap)).sort(), [
      "academic",
      "general",
      "media",
      "system",
    ]);
  });

  it("heals nothing on a failure that is not a missing carrier", async () => {
    const before = telegram.calls.length;
    await assert.rejects(() => surface().post("general", ""), TelegramApiError);
    assert.deepEqual(
      telegram.calls.slice(before).map((call) => call.method),
      ["sendMessage"],
    );
  });
});
