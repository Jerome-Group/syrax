/**
 * The daily sweep at the provider wire, which is the only place it can be measured: what it does is
 * spend a request per chain rung, and what makes it worth its cost is which rungs it reaches.
 *
 * The log-backed half is in `rung-watch.test.ts`. This one is about the rungs the log cannot speak
 * for — the ones beneath the serving rung — and about the lane it must never touch.
 */

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { writeCarrierMap, type CarrierMap } from "../src/adapter/carriers.ts";
import { readDeployment, type Deployment } from "../src/adapter/deployment.ts";
import { frontLane } from "../src/adapter/front-lane.ts";
import { hatchLane, rungId } from "../src/adapter/hatch-lane.ts";
import { modelRef } from "../src/adapter/lane.ts";
import { chainLanes } from "../src/adapter/lanes.ts";
import { workerLane } from "../src/adapter/worker-lane.ts";
import { LaneMonitor } from "../src/monitor/lane-monitor.ts";
import { everyProviderAt, writeSecretsStore } from "./gateway.ts";
import { standInRuntime, temporaryMachine } from "./machine.ts";
import { ProviderStub } from "./stubs/openai-provider.ts";
import { TelegramStub } from "./stubs/telegram-bot-api.ts";

const botToken = "6100000000:STUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTU";

/** The worker lane's floor: a rung the log will not speak for until three above it have failed. */
const buriedRung = modelRef(workerLane.rungs.at(-1)!);
const gone = "The model `glm-4.5-flash` does not exist. The paid version is available now.";

const everyChainRung = chainLanes.flatMap((lane) => lane.rungs.map((rung) => rung.modelId));

describe("the daily sweep", () => {
  let telegram: TelegramStub;
  let provider: ProviderStub;
  let deployment: Deployment;
  let carriers: CarrierMap;

  before(async () => {
    telegram = await TelegramStub.start(botToken);
  });

  after(async () => {
    await telegram?.close();
  });

  beforeEach(async () => {
    provider = await ProviderStub.start({ standingReply: { kind: "reply", text: "here" } });
    const machine = temporaryMachine();
    deployment = readDeployment({
      ...machine.deployment,
      secretsStore: writeSecretsStore(machine.deployment.secretsStore as string, botToken),
      telegramApiRoot: telegram.apiRoot,
      providerBaseUrls: everyProviderAt(provider.baseUrl),
    });
    carriers = { system: telegram.createTopic() };
    writeCarrierMap(deployment.carrierMap, carriers);
    standInRuntime(deployment.runtimeRoot);
  });

  afterEach(async () => {
    await provider?.close();
  });

  it("sends a real completion through every chain rung, and through none of the hatch's", async () => {
    const monitor = new LaneMonitor(deployment);

    const { swept } = await monitor.sweep();

    assert.deepEqual(provider.askedModels, everyChainRung);
    for (const rung of hatchLane.rungs) {
      assert.equal(
        provider.askedModels.includes(rung.modelId),
        false,
        `${rungId(rung)} carries 20 requests a day, and the sweep spent one of them.`,
      );
    }
    assert.equal(swept.length, everyChainRung.length);
    assert.equal(
      swept.every((one) => one.answered),
      true,
    );
  });

  it("finds a rung the log would never have spoken for, in the provider's own words", async () => {
    provider.scriptModel(workerLane.rungs.at(-1)!.modelId, { kind: "vanished", message: gone });
    const monitor = new LaneMonitor(deployment);

    const { moved } = await monitor.sweep();

    assert.deepEqual(
      moved.map((one) => one.kind),
      ["a rotted rung"],
    );
    assert.match(moved[0]!.said, /The paid version is available now/);
    assert.deepEqual(
      monitor.rungs.rotted().map((one) => one.rung),
      [buriedRung],
    );
  });

  it("reports it once, and lists it in between rather than posting it again", async () => {
    provider.scriptModel(workerLane.rungs.at(-1)!.modelId, { kind: "vanished", message: gone });
    const monitor = new LaneMonitor(deployment);

    await monitor.sweep();
    const crossed = telegram.calls.length;
    provider.scriptModel(workerLane.rungs.at(-1)!.modelId, { kind: "vanished", message: gone });
    const again = await monitor.sweep();

    assert.deepEqual(again.moved, [], "a rung nobody has acted on was announced twice.");
    assert.equal(telegram.calls.length, crossed, "nothing moved and something was posted.");
    assert.match(
      String(monitor.report().watched.rotted[0]?.said),
      /The paid version is available now/,
    );
  });

  it("takes a rung that answers again as recovered, and a refusal as neither", async () => {
    const floor = workerLane.rungs.at(-1)!.modelId;
    provider.scriptModel(floor, { kind: "vanished", message: gone });
    const monitor = new LaneMonitor(deployment);
    await monitor.sweep();

    provider.scriptModel(floor, {
      kind: "rateLimited",
      code: "rate_limit_exceeded",
      message: "the day's requests are gone",
      retryAfterSeconds: 60,
    });
    const refused = await monitor.sweep();
    const heldOn = monitor.rungs.rotted().map((one) => one.rung);
    const answered = await monitor.sweep();

    assert.deepEqual(
      refused.moved,
      [],
      "a rung that refused a request was read as one that is gone.",
    );
    assert.deepEqual(heldOn, [buriedRung], "a refusal was read as the rung coming back.");
    assert.deepEqual(
      answered.moved.map((one) => one.kind),
      ["a recovered rung"],
    );
    assert.deepEqual(monitor.rungs.rotted(), []);
  });

  it("does not ask after a rung the Owner has already taken out of its lane", async () => {
    const monitor = new LaneMonitor(deployment);
    monitor.removals.remove(modelRef(frontLane.rungs[1]!), "it was tapped out");

    await monitor.sweep();

    assert.equal(provider.askedModels.includes(frontLane.rungs[1]!.modelId), false);
    assert.equal(provider.askedModels.length, everyChainRung.length - 1);
  });

  it("leaves the hatch to observe its own failures, beside its own counters", async () => {
    provider.scriptModel(hatchLane.rungs[0]!.modelId, { kind: "vanished", message: gone });
    const monitor = new LaneMonitor(deployment);

    await monitor.hatch.reach({ question: "a hard one", askedFor: "use the escape hatch" });
    await monitor.sweep();

    const spent = monitor.counters.state().find((one) => one.rung === rungId(hatchLane.rungs[0]!))!;
    assert.equal(spent.refused?.status, 404);
    assert.match(String(spent.refused?.said), /The paid version is available now/);
    assert.deepEqual(
      monitor.rungs.rotted(),
      [],
      "a rationed rung was reported as a rotted chain rung.",
    );
  });
});
