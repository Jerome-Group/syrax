/**
 * A stand down at the two places it has to be true at once: the generated configuration, which is
 * the lane's membership, and the command Syrax ran against the runtime to land it. A write with no
 * lander is not a stand down (ADR-0021), so both are asserted every time.
 *
 * The ledger is the third, and it is what startup is measured against: a configuration written from
 * the authored contract must not be able to revert a live stand down, nor to hold a stale one.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { buildRuntimeConfig } from "../src/adapter/build.ts";
import { writeCarrierMap, type CarrierMap } from "../src/adapter/carriers.ts";
import { readDeployment, type Deployment } from "../src/adapter/deployment.ts";
import { frontLane } from "../src/adapter/front-lane.ts";
import { generateConfig } from "../src/adapter/generator.ts";
import { modelRef } from "../src/adapter/lane.ts";
import { runtimeLogPath } from "../src/adapter/runtime-log.ts";
import { writePrivateFile } from "../src/adapter/private-state.ts";
import { workerLane } from "../src/adapter/worker-lane.ts";
import { LaneMonitor } from "../src/monitor/lane-monitor.ts";
import { standDownLedger, type StandDown } from "../src/adapter/stand-down-ledger.ts";
import {
  runtimeIsInstalled,
  standSyrax,
  turn,
  turnsUntil,
  writeSecretsStore,
  type SyraxFixture,
} from "./gateway.ts";
import { standInRuntime, temporaryMachine } from "./machine.ts";
import { TelegramStub } from "./stubs/telegram-bot-api.ts";

const botToken = "6100000000:STUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTU";

/** A refusal for size, in the shape the runtime logs one: the status is what tells it from a rate
 * limit or a context overflow, all three of which are worded alike (ADR-0035). */
function sizeRefusal(at: string, candidate: string, requested: number, limit: number): string {
  const [provider, ...model] = candidate.split("/");
  return JSON.stringify({
    0: '{"subsystem":"model-fallback/decision"}',
    1: {
      event: "model_fallback_decision",
      decision: "candidate_failed",
      requestedProvider: provider,
      requestedModel: model.join("/"),
      candidateProvider: provider,
      candidateModel: model.join("/"),
      reason: "rate_limit",
      status: 413,
      providerErrorMessagePreview: `Request too large. Limit ${limit}, Requested ${requested}, on tokens per minute (TPM).`,
    },
    2: "model fallback decision",
    time: at,
  });
}

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

  /** The front lane's Groq rung refusing a call for its size, in the runtime's log. Returns it. */
  function writeSizeRefusal(): string {
    const rung = frontLane.rungs.find((each) => each.perRequestCeilingTokens !== null)!;
    writeFileSync(
      runtimeLogPath(deployment.logsDir),
      `${sizeRefusal(new Date().toISOString(), modelRef(rung), rung.perRequestCeilingTokens! + 800, rung.perRequestCeilingTokens!)}\n`,
    );
    return modelRef(rung);
  }

  /** The front lane exactly as the running gateway would take it. */
  function frontChain(): { primary: string; fallbacks: string[] } {
    const written = JSON.parse(readFileSync(deployment.configPath, "utf8")) as {
      agents: { defaults: { model: { primary: string; fallbacks: string[] } } };
    };
    return written.agents.defaults.model;
  }

  /** Just the gateway methods a landing asked for, in order: the sequence is what is measured. */
  function methodsRun(): string[] {
    return ranAgainstTheRuntime()
      .filter((one) => one.startsWith("gateway call "))
      .map((one) => one.split(" ")[2]!);
  }

  function ranAgainstTheRuntime(): string[] {
    return existsSync(commands) ? readFileSync(commands, "utf8").trim().split("\n") : [];
  }

  function ledger(): StandDown[] {
    return JSON.parse(
      readFileSync(standDownLedger(deployment.monitorState), "utf8"),
    ) as StandDown[];
  }

  it("writes the rung out of its lane before it answers, and lands it after", async () => {
    const monitor = new LaneMonitor(deployment);

    const stood = monitor.standDown({
      rung: secondRung,
      until: new Date(Date.now() + 3_600_000),
      why: "the day's requests are gone",
    });

    // The answer is what ends the turn the land is waiting for, so the write is done and the
    // landing is not: nothing has been run against the runtime yet.
    assert.equal(stood.standDown.rung, secondRung);
    assert.deepEqual(frontChain().fallbacks, [modelRef(frontLane.rungs[2]!)]);
    assert.deepEqual(ranAgainstTheRuntime(), [], "it landed inside the turn that asked for it.");

    const landed = await stood.landing;

    assert.equal(landed.landed, true, landed.said);
    assert.match(landed.said, /the sessions stand/);
    // It opens with an admin call because the CLI mints this machine's pairing from the first
    // method it is asked for, and a read-scoped one leaves every call after it refused.
    assert.deepEqual(methodsRun(), [
      "channels.start",
      "gateway.restart.preflight",
      "channels.stop",
      "channels.start",
      "channels.status",
    ]);
    assert.equal(
      ranAgainstTheRuntime().some((one) => one.includes("restart --safe")),
      false,
    );
  });

  it("says so in System, with the reason and the reset it is bounded by", async () => {
    const monitor = new LaneMonitor(deployment);
    const crossed = telegram.calls.length;
    const until = new Date(Date.now() + 3_600_000);

    await monitor.standDown({ rung: secondRung, until, why: "the day's requests are gone" })
      .landing;

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

    const stood = monitor.standDown({
      rung: secondRung,
      until: new Date(Date.now() + 200),
      why: "a minute's worth",
    });

    // Read before anything is awaited: the rung is out of the lane the moment the tool answers,
    // and the landing that follows is what the reset's return will queue behind.
    assert.deepEqual(
      ledger().map((held) => held.rung),
      [secondRung],
    );
    await stood.landing;
    assert.equal(stood.standDown.rung, secondRung);
    const posted = () =>
      telegram.calls
        .slice(crossed)
        .filter((call) => call.method === "sendMessage")
        .map((call) => String(call.body.text));
    await returned(() => posted().length === 2);
    assert.deepEqual(ledger(), []);
    assert.deepEqual(frontChain().fallbacks, frontLane.rungs.slice(1).map(modelRef));
    assert.equal(methodsRun().length, 10, "the return landed no write of its own.");
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

  it("tells a size stand down from an allowance one, and refuses it a lane it would empty", () => {
    const monitor = new LaneMonitor(deployment);
    const until = new Date(Date.now() + 3_600_000);

    const spent = monitor.standDowns.stand({ rung: secondRung, until, why: "spent" });
    const outgrown = monitor.standDowns.stand({
      rung: modelRef(frontLane.rungs.at(-1)!),
      until,
      why: "the session has grown past what this rung will take",
      kind: "size",
    });

    assert.equal(spent.kind, "allowance", "a stand down with no kind stated is not an allowance.");
    assert.equal(outgrown.kind, "size");
    // The guard does not care which kind emptied the lane, and that is the point of asserting it
    // here: a lane the monitor emptied answers exactly as little as one the Owner emptied.
    assert.throws(
      () =>
        monitor.standDowns.stand({
          rung: modelRef(frontLane.rungs[0]!),
          until,
          why: "outgrown",
          kind: "size",
        }),
      /last rung/,
    );
  });

  it("stands a rung the traffic outgrew out of its lane once, and not again unasked", async () => {
    // Real time throughout: the return is scheduled against the wall clock, so a stand down dated
    // in the past comes straight back and the loop under test would look like it never ran.
    const outgrew = writeSizeRefusal();
    const monitor = new LaneMonitor(deployment);

    await monitor.watchRungs();
    const first = monitor.standDowns.active();
    // Nothing new has reached the log, so a second poke has no fresh refusal to act on.
    await monitor.watchRungs();
    const second = monitor.standDowns.active();

    assert.deepEqual(
      first.map((held) => ({ rung: held.rung, kind: held.kind })),
      [{ rung: outgrew, kind: "size" }],
    );
    assert.deepEqual(second, first, "the same refusal stood the rung down twice.");
    assert.ok(
      !frontChain().fallbacks.includes(outgrew),
      "the rung is in the ledger and still in the written chain.",
    );
  });

  it("puts an outgrown rung back to be tried, and forgets the refusal that took it out", async () => {
    const outgrew = writeSizeRefusal();
    const monitor = new LaneMonitor(deployment);
    await monitor.watchRungs();

    await monitor.bringBack(outgrew).landing;

    assert.deepEqual(monitor.standDowns.active(), []);
    assert.deepEqual(
      monitor.rungs.outgrown(),
      [],
      "the refusal it was taken out on outlived the return, so it would go straight back out untried.",
    );
    assert.deepEqual(frontChain().fallbacks, frontLane.rungs.slice(1).map(modelRef));
  });

  it("reads a ledger written before stand downs had kinds as the allowance ones they were", () => {
    const until = new Date(Date.now() + 3_600_000).toISOString();
    writePrivateFile(
      standDownLedger(deployment.monitorState),
      JSON.stringify([
        { rung: secondRung, lane: "front", at: new Date().toISOString(), until, why: "spent" },
      ]),
    );

    const monitor = new LaneMonitor(deployment);

    assert.deepEqual(
      monitor.standDowns.active().map((held) => ({ rung: held.rung, kind: held.kind })),
      [{ rung: secondRung, kind: "allowance" }],
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
    assert.deepEqual(methodsRun(), [
      "channels.start",
      "gateway.restart.preflight",
      "channels.stop",
      "channels.start",
      "channels.status",
    ]);
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

  it("restarts rather than leave the chat deaf, where the channel will not come back", async () => {
    commands = standInRuntime(deployment.runtimeRoot, { wedged: true });
    const monitor = new LaneMonitor(deployment);

    const landed = await monitor.standDown({
      rung: secondRung,
      until: new Date(Date.now() + 3_600_000),
      why: "the day's requests are gone",
    }).landing;

    assert.equal(landed.landed, true, landed.said);
    assert.match(landed.said, /restarted safely/);
    assert.match(landed.said, /did not come back up/);
    assert.ok(
      ranAgainstTheRuntime().at(-1)!.startsWith("gateway restart --safe"),
      "it left the channel down.",
    );
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

/**
 * The claim the unit tests above cannot make: that the rung is gone from the lane a **running**
 * gateway answers on, and that it went without a restart. It is measured where ADR-0021 measured
 * the question it corrects — at the provider wire, on the model the next turn is sent to.
 */
describe("a stand down over a real gateway", { skip: !runtimeIsInstalled() }, () => {
  const gemini = "gemini-3.5-flash-lite";
  const mistral = "ministral-3b-latest";
  let syrax: SyraxFixture;

  after(async () => {
    await syrax?.stop();
  });

  it("lands on the next turn without a restart, and the sessions stand", async () => {
    syrax = await standSyrax({ catalogue: [gemini, mistral] });
    // One turn before the write: it says where the measurement starts, and it lets the config
    // watcher attach — the gateway starts it after reporting itself ready.
    assert.equal((await turn(syrax, "Which model is this?")).model, gemini);
    // The fixture read it when it stood the gateway, and a `Deployment` is not the shape
    // `readDeployment` maps: reading it twice drops the academic paths into a nested field the
    // second pass cannot see, and the generator then refuses a machine that named all six (#196).
    const monitor = new LaneMonitor(syrax.gateway.deployment);

    const stood = await monitor.standDown({
      rung: `syrax-gemini/${gemini}`,
      until: new Date(Date.now() + 3_600_000),
      why: "the day's requests are gone",
    }).landing;

    assert.equal(stood.landed, true, stood.said);
    assert.match(stood.said, /the sessions stand/);

    const landed = await turnsUntil(
      syrax,
      "Which model is this?",
      syrax.carriers.general,
      (each) => each.model === mistral,
    );
    assert.ok(
      landed.landed,
      `the stand down never reached a turn: ${JSON.stringify(landed.turns)}`,
    );
    assert.equal(landed.turns.length, 1, `it took ${landed.turns.length} turns to land.`);
    // The sessions are what the other lander spends: the turn after the landing still carries what
    // was said before it.
    assert.match(JSON.stringify(syrax.provider.requests.at(-1)?.body), /Which model is this/);
  });
});
