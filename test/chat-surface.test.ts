/**
 * The write path at the Telegram wire: what crossed it when a carrier was there, and what crossed
 * it when the Owner had cleared one. Nothing here starts a gateway — these are Syrax's own writes,
 * which is where a cleared carrier is discovered at all.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { readCarrierMap, writeCarrierMap, type CarrierMap } from "../src/adapter/carriers.ts";
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

  it("preserves different chats recreated by independent overlapping surfaces", async () => {
    telegram.clearTopic(carriers.academic!);
    telegram.clearTopic(carriers.media!);
    const [academic, media] = await Promise.all([
      surface().post("academic", "Academic report"),
      surface().post("media", "Media report"),
    ]);
    const map = readCarrierMap(deployment.carrierMap);
    assert.equal(map.academic, academic[0]!.id);
    assert.equal(map.media, media[0]!.id);
    const config = JSON.parse(readFileSync(deployment.configPath, "utf8"));
    const topics = config.channels.telegram.direct[String(ownerTelegramUserId)].topics;
    assert.deepEqual(topics[String(map.academic)], { agentId: "academic" });
    assert.deepEqual(topics[String(map.media)], { agentId: "media" });
  });

  it("creates and announces one replacement for overlapping sends to the same chat", async () => {
    telegram.clearTopic(carriers.academic!);
    const before = telegram.calls.length;
    const results = await Promise.all([
      surface().post("academic", "First report"),
      surface().post("academic", "Second report"),
    ]);
    assert.equal(results.flat().length, 1);
    const calls = telegram.calls.slice(before);
    assert.equal(calls.filter((call) => call.method === "createForumTopic").length, 1);
    assert.equal(
      calls.filter((call) => String(call.body.text).includes("came back empty")).length,
      1,
    );
    const replacement = results.flat()[0]!.id;
    const delivered = calls.filter((call) => call.body.message_thread_id === replacement);
    assert.equal(delivered.length, 2);
  });

  it("provisions one set of missing carriers across overlapping surfaces", async () => {
    carriers = { system: carriers.system! };
    const before = telegram.calls.length;
    const provisioned = await Promise.all([surface().provision(), surface().provision()]);
    assert.deepEqual(
      provisioned
        .flat()
        .map((carrier) => carrier.chat.id)
        .sort(),
      ["academic", "general", "media"],
    );
    assert.equal(
      telegram.calls.slice(before).filter((call) => call.method === "createForumTopic").length,
      3,
    );
    assert.equal(
      telegram.calls.slice(before).filter((call) => call.method === "sendMessage").length,
      0,
    );
  });

  it("repairs routing after a replacement map was saved but configuration publication failed", async () => {
    telegram.clearTopic(carriers.academic!);
    const configuration = deployment.configPath;
    deployment = { ...deployment, configPath: deployment.workspace };
    const before = telegram.calls.length;
    await assert.rejects(surface().post("academic", "First attempt"));
    const replacement = readCarrierMap(deployment.carrierMap).academic;
    assert.ok(replacement);
    deployment = { ...deployment, configPath: configuration };
    assert.deepEqual(await surface().post("academic", "Retry report"), []);
    const config = JSON.parse(readFileSync(configuration, "utf8"));
    assert.deepEqual(
      config.channels.telegram.direct[String(ownerTelegramUserId)].topics[String(replacement)],
      { agentId: "academic" },
    );
    assert.equal(
      telegram.calls.slice(before).filter((call) => call.method === "createForumTopic").length,
      1,
    );
  });

  it("preserves carrier updates made by separate processes", { timeout: 10_000 }, async () => {
    const fixture = temporaryMachine();
    const path = join(fixture.root, "deployment.json");
    writeFileSync(
      path,
      JSON.stringify({
        ...fixture.deployment,
        secretsStore: deployment.secretsStore,
        telegramApiRoot: deployment.telegramApiRoot,
        configPath: deployment.configPath,
        carrierMap: deployment.carrierMap,
        workspace: deployment.workspace,
        stateDir: deployment.stateDir,
        logsDir: deployment.logsDir,
      }),
    );
    telegram.clearTopic(carriers.academic!);
    telegram.clearTopic(carriers.media!);
    const source = `import { readFileSync } from "node:fs";
import { readDeployment } from ${JSON.stringify(new URL("../src/adapter/deployment.ts", import.meta.url).href)};
import { ChatSurface } from ${JSON.stringify(new URL("../src/surface/chat-surface.ts", import.meta.url).href)};
const surface = ChatSurface.open(readDeployment(JSON.parse(readFileSync(process.argv[1], "utf8"))));
process.stdout.write("ready\\n");
process.stdin.once("data", async () => {
  process.stdout.write(JSON.stringify(await surface.post(process.argv[2], "process report")));
  process.stdin.destroy();
});`;
    function worker(chat: string) {
      const child = spawn(process.execPath, ["--input-type=module", "-e", source, path, chat], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      let errors = "";
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        errors += chunk.toString("utf8");
      });
      const ready = new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => reject(new Error(`worker exited ${code}: ${errors}`)));
        child.stdout.once("data", () => resolve());
      });
      const result = new Promise<number>((resolve, reject) =>
        child.once("close", (code) => {
          if (code !== 0) return reject(new Error(errors));
          resolve(JSON.parse(output.slice(output.indexOf("\n") + 1))[0].id);
        }),
      );
      void result.catch(() => {});
      return { child, ready, result };
    }
    writeCarrierMap(deployment.carrierMap, carriers as CarrierMap);
    const academic = worker("academic");
    const media = worker("media");
    try {
      await Promise.all([academic.ready, media.ready]);
      academic.child.stdin.end("go");
      media.child.stdin.end("go");
      const [academicId, mediaId] = await Promise.all([academic.result, media.result]);
      const map = readCarrierMap(deployment.carrierMap);
      assert.equal(map.academic, academicId);
      assert.equal(map.media, mediaId);
    } finally {
      academic.child.kill("SIGKILL");
      media.child.kill("SIGKILL");
    }
  });

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
