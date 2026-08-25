/**
 * The removal tap, at the three places it has to be true at once: the button on the message that
 * crossed the Telegram wire, the ledger, and the generated configuration the gateway composes its
 * chains from. A write with no lander is not a removal (ADR-0021), so the command run against the
 * runtime is asserted with them.
 *
 * The other half of ADR-0012 is what is *not* here, and it is measured rather than assumed: a
 * rotted rung found by the sweep leaves the chain exactly as it was until the Owner taps.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { writeCarrierMap, type CarrierMap } from "../src/adapter/carriers.ts";
import { readDeployment, type Deployment } from "../src/adapter/deployment.ts";
import { frontLane } from "../src/adapter/front-lane.ts";
import { generateConfig } from "../src/adapter/generator.ts";
import { modelRef } from "../src/adapter/lane.ts";
import { removalLedger, type Removed } from "../src/adapter/removal-ledger.ts";
import { workerLane } from "../src/adapter/worker-lane.ts";
import { LaneMonitor } from "../src/monitor/lane-monitor.ts";
import { everyProviderAt, writeSecretsStore } from "./gateway.ts";
import { standInRuntime, temporaryMachine } from "./machine.ts";
import { ProviderStub } from "./stubs/openai-provider.ts";
import { TelegramStub, type OutboundCall } from "./stubs/telegram-bot-api.ts";

const botToken = "6100000000:STUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTU";

/** The front lane's second rung, and the words a provider retires one in. */
const secondRung = frontLane.rungs[1]!;
const gone = "The model `ministral-3b-latest` does not exist. The paid version is available now.";

type Keyboard = { inline_keyboard: { text: string; callback_data: string }[][] };

function keyboardOf(call: OutboundCall): Keyboard {
  return call.body.reply_markup as Keyboard;
}

describe("removing a rotted rung", () => {
  let telegram: TelegramStub;
  let provider: ProviderStub;
  let deployment: Deployment;
  let carriers: CarrierMap;
  let commands: string;
  let crossedBefore = 0;

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
    commands = standInRuntime(deployment.runtimeRoot);
    generateConfig(deployment, carriers);
    crossedBefore = telegram.calls.length;
  });

  afterEach(async () => {
    await provider?.close();
  });

  function posts(): OutboundCall[] {
    return telegram.calls.slice(crossedBefore).filter((call) => call.method === "sendMessage");
  }

  function frontChain(): { primary: string; fallbacks: string[] } {
    const written = JSON.parse(readFileSync(deployment.configPath, "utf8")) as {
      agents: { defaults: { model: { primary: string; fallbacks: string[] } } };
    };
    return written.agents.defaults.model;
  }

  function ranAgainstTheRuntime(): string[] {
    return existsSync(commands) ? readFileSync(commands, "utf8").trim().split("\n") : [];
  }

  function ledger(): Removed[] {
    return JSON.parse(readFileSync(removalLedger(deployment.monitorState), "utf8")) as Removed[];
  }

  /** A monitor that has just found the front lane's second rung gone, and posted about it. */
  async function foundRotted(): Promise<LaneMonitor> {
    provider.scriptModel(secondRung.modelId, { kind: "vanished", message: gone });
    const monitor = new LaneMonitor(deployment);
    await monitor.sweep();
    return monitor;
  }

  it("posts the rotted rung with a button beneath it, in the provider's own words", async () => {
    await foundRotted();

    const reported = posts().at(-1)!;

    assert.match(String(reported.body.text), /The paid version is available now/);
    const buttons = keyboardOf(reported).inline_keyboard.flat();
    assert.deepEqual(
      buttons.map((button) => button.text),
      [`Remove ${modelRef(secondRung)}`],
    );
    assert.ok(
      Buffer.byteLength(buttons[0]!.callback_data) <= 64,
      "a callback carries sixty-four bytes and no more.",
    );
  });

  it("removes nothing until the tap, whatever the sweep found", async () => {
    const monitor = await foundRotted();

    assert.deepEqual(frontChain(), {
      primary: modelRef(frontLane.rungs[0]!),
      fallbacks: [modelRef(secondRung), modelRef(frontLane.rungs[2]!)],
    });
    assert.deepEqual(monitor.removals.removed(), []);
    assert.equal(existsSync(removalLedger(deployment.monitorState)), false);
    assert.deepEqual(
      ranAgainstTheRuntime(),
      [],
      "a rung was written out of a lane nobody asked about.",
    );
  });

  it("writes the rung out on the tap, and lands it after the turn that tapped", async () => {
    const monitor = await foundRotted();
    const tapped = keyboardOf(posts().at(-1)!).inline_keyboard.flat()[0]!.callback_data;

    const removal = monitor.removeRung(tapped);

    // The answer is what ends the turn the land is waiting for: the write is done, the land is not.
    assert.equal(removal.removed?.rung, modelRef(secondRung));
    assert.equal(removal.removed?.lane, "front");
    assert.equal(removal.removed?.said, gone);
    assert.deepEqual(frontChain().fallbacks, [modelRef(frontLane.rungs[2]!)]);
    assert.deepEqual(ranAgainstTheRuntime(), [], "it landed inside the turn that asked for it.");

    const landed = await removal.landing;

    assert.equal(landed?.landed, true, String(landed?.said));
    assert.deepEqual(
      ledger().map((one) => one.rung),
      [modelRef(secondRung)],
    );
    assert.match(String(posts().at(-1)!.body.text), /out of the front lane for good/);
  });

  it("stops listing it once it is out, since there is nothing left to act on", async () => {
    const monitor = await foundRotted();
    const tapped = keyboardOf(posts().at(-1)!).inline_keyboard.flat()[0]!.callback_data;

    await monitor.removeRung(tapped).landing;
    const report = monitor.report();

    assert.deepEqual(report.watched.rotted, []);
    const front = report.lanes.find((one) => one.lane === "front")!;
    assert.deepEqual(front.serving, [modelRef(frontLane.rungs[0]!), modelRef(frontLane.rungs[2]!)]);
    assert.deepEqual(
      front.removed.map((one) => one.rung),
      [modelRef(secondRung)],
    );
    assert.equal(keyboardOf(posts().at(-1)!), undefined, "a removed rung was offered again.");
  });

  it("removes nothing for a value it did not mint, however well formed", async () => {
    const monitor = await foundRotted();
    const tapped = keyboardOf(posts().at(-1)!).inline_keyboard.flat()[0]!.callback_data;

    const guessed = monitor.removeRung(`remove:${modelRef(secondRung)}`);
    const composed = monitor.removeRung(`${tapped}x`);

    assert.equal(guessed.removed, null);
    assert.equal(composed.removed, null);
    assert.match(guessed.said, /not one this monitor can resolve/);
    assert.deepEqual(monitor.removals.removed(), []);
    assert.deepEqual(frontChain().fallbacks, [modelRef(secondRung), modelRef(frontLane.rungs[2]!)]);
  });

  it("survives the ledger across a restart, and never puts the rung back", async () => {
    const monitor = await foundRotted();
    const tapped = keyboardOf(posts().at(-1)!).inline_keyboard.flat()[0]!.callback_data;
    await monitor.removeRung(tapped).landing;

    // A redeploy from the authored contract, which is what must not be able to revert it.
    generateConfig(deployment, carriers);
    const restarted = new LaneMonitor(deployment);

    assert.deepEqual(restarted.removals.rungs(), [modelRef(secondRung)]);
    assert.deepEqual(frontChain().fallbacks, [modelRef(frontLane.rungs[2]!)]);
    assert.equal(await restarted.reconcile(), null, "a removal it already holds was landed again.");
  });

  it("writes and lands nothing when the same button is tapped twice", async () => {
    const monitor = await foundRotted();
    const tapped = keyboardOf(posts().at(-1)!).inline_keyboard.flat()[0]!.callback_data;
    await monitor.removeRung(tapped).landing;
    const landings = ranAgainstTheRuntime().length;
    const posted = posts().length;

    const again = monitor.removeRung(tapped);

    assert.equal(again.removed, null);
    assert.match(again.said, /already out of its lane/);
    assert.equal(again.landing, undefined, "a second tap reloaded the channel for nothing.");
    assert.equal(ranAgainstTheRuntime().length, landings);
    assert.equal(posts().length, posted);
    assert.deepEqual(
      ledger().map((one) => one.rung),
      [modelRef(secondRung)],
    );
  });

  it("counts the rungs standing down against the lane it would empty", async () => {
    const monitor = new LaneMonitor(deployment);
    for (const rung of frontLane.rungs.slice(1)) {
      // Awaited here, unlike in a turn: what is being measured is the state the two leave behind.
      await monitor.standDown({
        rung: modelRef(rung),
        until: new Date(Date.now() + 3_600_000),
        why: "the day's requests are gone",
      }).landing;
    }

    assert.throws(
      () =>
        monitor.removals.remove(
          modelRef(frontLane.rungs[0]!),
          gone,
          monitor.standDowns.active().map((held) => held.rung),
        ),
      /last rung/,
    );
    assert.equal(existsSync(removalLedger(deployment.monitorState)), false);
  });

  it("refuses a lane's last rung, since a lane with none answers nothing", async () => {
    const monitor = new LaneMonitor(deployment);
    for (const rung of workerLane.rungs.slice(0, -1)) {
      monitor.removals.remove(modelRef(rung), "it was tapped out");
    }

    assert.throws(
      () => monitor.removals.remove(modelRef(workerLane.rungs.at(-1)!), "it was tapped out"),
      /last rung/,
    );
  });
});
