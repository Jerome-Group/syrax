/**
 * A stand down at the two places it has to be true at once: the generated configuration, which is
 * the lane's membership, and the command Syrax ran against the runtime to land it. A write with no
 * lander is not a stand down (ADR-0021), so both are asserted every time.
 *
 * The ledger is the third, and it is what startup is measured against: a configuration written from
 * the authored contract must not be able to revert a live stand down, nor to hold a stale one.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { buildRuntimeConfig } from "../src/adapter/build.ts";
import { writeCarrierMap, type CarrierMap } from "../src/adapter/carriers.ts";
import { readDeployment, type Deployment } from "../src/adapter/deployment.ts";
import { frontLane } from "../src/adapter/front-lane.ts";
import { generateConfig } from "../src/adapter/generator.ts";
import { modelRef } from "../src/adapter/lane.ts";
import { writePrivateFile } from "../src/adapter/private-state.ts";
import { workerLane } from "../src/adapter/worker-lane.ts";
import { LaneMonitor } from "../src/monitor/lane-monitor.ts";
import { standDownLedger, type StandDown } from "../src/adapter/stand-down-ledger.ts";
import { writeSecretsStore } from "./gateway.ts";
import { standInRuntime, temporaryMachine } from "./machine.ts";
import { TelegramStub } from "./stubs/telegram-bot-api.ts";

const botToken = "6100000000:STUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTU";

/** The front lane's second rung: one a stand down can take without emptying anything. */
const secondRung = modelRef(frontLane.rungs[1]!);
const workerFloor = modelRef(workerLane.rungs.at(-1)!);

describe("a stand down", () => {
  let telegram: TelegramStub;
  let deployment: Deployment;
  let carriers: CarrierMap;
  let commands: string;

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
    carriers = { system: telegram.createTopic() };
    writeCarrierMap(deployment.carrierMap, carriers);
    commands = standInRuntime(deployment.runtimeRoot);
    generateConfig(deployment, carriers);
  });

  /** The front lane exactly as the running gateway would take it. */
  function frontChain(): { primary: string; fallbacks: string[] } {
    const written = JSON.parse(readFileSync(deployment.configPath, "utf8")) as {
      agents: { defaults: { model: { primary: string; fallbacks: string[] } } };
    };
    return written.agents.defaults.model;
  }

  function ranAgainstTheRuntime(): string[] {
    return existsSync(commands) ? readFileSync(commands, "utf8").trim().split("\n") : [];
  }

  function ledger(): StandDown[] {
    return JSON.parse(
      readFileSync(standDownLedger(deployment.monitorState), "utf8"),
    ) as StandDown[];
  }

  it("takes the rung out of its lane and lands the write with the runtime's safe restart", async () => {
    const monitor = new LaneMonitor(deployment);

    const stood = await monitor.standDown({
      rung: secondRung,
      until: new Date(Date.now() + 3_600_000),
      why: "the day's requests are gone",
    });

    assert.equal(stood.landed.landed, true, stood.landed.said);
    assert.deepEqual(frontChain().fallbacks, [modelRef(frontLane.rungs[2]!)]);
    assert.ok(
      !JSON.stringify(frontChain()).includes(secondRung),
      "the rung is still in the chain.",
    );
    assert.deepEqual(ranAgainstTheRuntime(), [`gateway restart --safe ${deployment.configPath}`]);
  });

  it("says so in System, with the reason and the reset it is bounded by", async () => {
    const monitor = new LaneMonitor(deployment);
    const crossed = telegram.calls.length;
    const until = new Date(Date.now() + 3_600_000);

    await monitor.standDown({ rung: secondRung, until, why: "the day's requests are gone" });

    const posted = telegram.calls.slice(crossed).filter((call) => call.method === "sendMessage");
    assert.equal(posted.length, 1);
    const said = String(posted[0]!.body.text);
    assert.match(said, /a stand down: syrax-mistral/);
    assert.match(said, new RegExp(until.toISOString()));
    assert.match(said, /the day's requests are gone/);
  });

  it("writes the return back at the stated reset rather than waiting on it", async () => {
    const monitor = new LaneMonitor(deployment);
    const crossed = telegram.calls.length;

    const stood = await monitor.standDown({
      rung: secondRung,
      until: new Date(Date.now() + 200),
      why: "a minute's worth",
    });

    assert.deepEqual(
      ledger().map((held) => held.rung),
      [secondRung],
    );
    assert.equal(stood.standDown.rung, secondRung);
    const posted = () =>
      telegram.calls
        .slice(crossed)
        .filter((call) => call.method === "sendMessage")
        .map((call) => String(call.body.text));
    await returned(() => posted().length === 2);
    assert.deepEqual(ledger(), []);
    assert.deepEqual(frontChain().fallbacks, frontLane.rungs.slice(1).map(modelRef));
    assert.deepEqual(ranAgainstTheRuntime().length, 2, "the return landed no write of its own.");
    assert.match(posted()[1]!, /a stand down returned/);
  });

  it("refuses a rung no lane holds, a reset already past, and a lane's last rung", () => {
    const monitor = new LaneMonitor(deployment);
    const until = new Date(Date.now() + 3_600_000);

    assert.throws(
      () => monitor.standDowns.stand({ rung: "syrax-gemini/nothing", until, why: "no" }),
      /no rung of either lane/,
    );
    assert.throws(
      () =>
        monitor.standDowns.stand({ rung: secondRung, until: new Date(Date.now() - 1), why: "no" }),
      /it has passed/,
    );
    for (const rung of workerLane.rungs.slice(0, -1)) {
      monitor.standDowns.stand({ rung: modelRef(rung), until, why: "spent" });
    }
    assert.throws(
      () => monitor.standDowns.stand({ rung: workerFloor, until, why: "spent" }),
      /last rung/,
    );
  });

  it("survives a redeploy: startup writes the lanes back the way the ledger has them", async () => {
    const until = new Date(Date.now() + 3_600_000).toISOString();
    writePrivateFile(
      standDownLedger(deployment.monitorState),
      JSON.stringify([
        { rung: secondRung, lane: "front", at: new Date().toISOString(), until, why: "spent" },
      ]),
    );
    // What a redeploy from the authored contract leaves behind: every rung, stand down or not.
    writePrivateFile(
      deployment.configPath,
      `${JSON.stringify(buildRuntimeConfig(deployment, carriers, []), null, 2)}\n`,
    );

    await new LaneMonitor(deployment).reconcile();

    assert.ok(!JSON.stringify(frontChain()).includes(secondRung), "the redeploy reverted it.");
    assert.deepEqual(ranAgainstTheRuntime(), [`gateway restart --safe ${deployment.configPath}`]);
  });

  it("never inherits one from the configuration: a rung out of the file and out of the ledger comes back", async () => {
    writePrivateFile(
      deployment.configPath,
      `${JSON.stringify(buildRuntimeConfig(deployment, carriers, [secondRung]), null, 2)}\n`,
    );

    await new LaneMonitor(deployment).reconcile();

    assert.deepEqual(frontChain().fallbacks, frontLane.rungs.slice(1).map(modelRef));
  });

  it("re-owns the return of one it found still standing at startup", async () => {
    writePrivateFile(
      standDownLedger(deployment.monitorState),
      JSON.stringify([
        {
          rung: secondRung,
          lane: "front",
          at: new Date().toISOString(),
          until: new Date(Date.now() + 200).toISOString(),
          why: "a minute's worth",
        },
      ]),
    );

    const crossed = telegram.calls.length;
    await new LaneMonitor(deployment).reconcile();

    await returned(() =>
      telegram.calls
        .slice(crossed)
        .some((call) => /a stand down returned/.test(String(call.body.text))),
    );
    assert.ok(frontChain().fallbacks.includes(secondRung), "the rung stayed out of its lane.");
    assert.deepEqual(ledger(), []);
  });

  it("says so when a reset arrived while the monitor was down, as it would in process", async () => {
    writePrivateFile(
      standDownLedger(deployment.monitorState),
      JSON.stringify([
        {
          rung: secondRung,
          lane: "front",
          at: new Date(Date.now() - 7_200_000).toISOString(),
          until: new Date(Date.now() - 3_600_000).toISOString(),
          why: "yesterday's",
        },
      ]),
    );
    const crossed = telegram.calls.length;

    await new LaneMonitor(deployment).reconcile();

    const posted = telegram.calls
      .slice(crossed)
      .filter((call) => call.method === "sendMessage")
      .map((call) => String(call.body.text));
    assert.equal(posted.length, 1, "the rung came back across a restart without a word.");
    assert.match(posted[0]!, /a stand down returned/);
    assert.match(posted[0]!, /while the monitor was down/);
  });

  it("drops one whose reset passed while nothing was running", () => {
    writePrivateFile(
      standDownLedger(deployment.monitorState),
      JSON.stringify([
        {
          rung: secondRung,
          lane: "front",
          at: new Date(Date.now() - 7_200_000).toISOString(),
          until: new Date(Date.now() - 3_600_000).toISOString(),
          why: "yesterday's",
        },
      ]),
    );

    const monitor = new LaneMonitor(deployment);

    assert.deepEqual(monitor.standDowns.active(), []);
    assert.deepEqual(ledger(), []);
  });
});

/** The return is owned rather than awaited, so a test waits for the file rather than for a call. */
async function returned(landed: () => boolean, within = 5000): Promise<void> {
  const until = Date.now() + within;
  while (Date.now() < until) {
    if (landed()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("the stand down was never written back.");
}
