/**
 * The usage report at its two audiences: the file it always leaves, and the System chat it reaches
 * only when something moved. What is asserted is what landed in each — a report nobody asked for
 * and nothing moved for is a message that never crossed the Telegram wire.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { readCarrierMap, writeCarrierMap, type CarrierMap } from "../src/adapter/carriers.ts";
import { readDeployment, type Deployment } from "../src/adapter/deployment.ts";
import { hatchLane, rungId } from "../src/adapter/hatch-lane.ts";
import { LaneMonitor } from "../src/monitor/lane-monitor.ts";
import type { Source } from "../src/monitor/sources.ts";
import { usageReportPath, type UsageReport } from "../src/monitor/usage-report.ts";
import { usageReportLine } from "../src/surface/usage-report.ts";
import { writeSecretsStore } from "./gateway.ts";
import { ownerTelegramUserId, temporaryMachine } from "./machine.ts";
import { ProviderStub } from "./stubs/openai-provider.ts";
import { TelegramStub } from "./stubs/telegram-bot-api.ts";

const botToken = "6100000000:STUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTU";
const askedFor = "use the escape hatch for this one";

/** Mistral's own words about itself, in the header names `telemetry.ts` reads them under. */
const mistralSaid = new Map([
  ["x-ratelimit-remaining-req-minute", "4"],
  ["x-ratelimit-limit-req-minute", "5"],
  ["x-ratelimit-remaining-tokens-minute", "9000"],
  ["x-ratelimit-limit-tokens-minute", "10000"],
]);

function headers(said: Map<string, string>) {
  return { get: (name: string) => said.get(name) ?? null };
}

function lane(report: UsageReport, name: string) {
  return report.lanes.find((one) => one.lane === name)!;
}

function source(report: UsageReport, name: string, provider: string): Source {
  return lane(report, name).sources.find((one) => one.provider === provider)!;
}

describe("the usage report", () => {
  let telegram: TelegramStub;
  let provider: ProviderStub;
  let deployment: Deployment;
  let carriers: CarrierMap;
  /** The stub outlives each test, so what this one sent starts where the last one finished. */
  let crossedBefore = 0;

  before(async () => {
    telegram = await TelegramStub.start(botToken);
    provider = await ProviderStub.start({ standingReply: { kind: "reply", text: "considered" } });
  });

  after(async () => {
    await telegram?.close();
    await provider?.close();
  });

  beforeEach(() => {
    const machine = temporaryMachine();
    deployment = readDeployment({
      ...machine.deployment,
      secretsStore: writeSecretsStore(machine.deployment.secretsStore as string, botToken),
      telegramApiRoot: telegram.apiRoot,
      providerBaseUrls: { "syrax-gemini": provider.baseUrl },
    });
    carriers = { system: telegram.createTopic() };
    writeCarrierMap(deployment.carrierMap, carriers);
    crossedBefore = telegram.calls.length;
  });

  function posts() {
    return telegram.calls.slice(crossedBefore).filter((call) => call.method === "sendMessage");
  }

  it("states each lane with the providers it reaches beneath it", () => {
    const monitor = new LaneMonitor(deployment);
    monitor.telemetry.observe(
      "syrax-mistral",
      headers(mistralSaid),
      new Date("2026-08-24T09:00:00Z"),
    );

    const report = monitor.report();

    assert.deepEqual(
      report.lanes.map((one) => one.lane),
      ["front", "worker", "hatch"],
    );
    assert.deepEqual(source(report, "front", "syrax-mistral").headroom, {
      kind: "reported",
      rungs: {
        requests: { window: "minute", remaining: 4, limit: 5 },
        tokens: { window: "minute", remaining: 9000, limit: 10000 },
      },
    });
    assert.equal(source(report, "front", "syrax-mistral").lastReadAt, "2026-08-24T09:00:00.000Z");
  });

  it("counts the rationed lane and reports the chain lanes, never the one for the other", () => {
    const report = new LaneMonitor(deployment).report();

    // Gemini is the provider that reports nothing, so the hatch's rungs are counted here — and
    // that count is the hatch's allowance, which says nothing at all about the front lane's.
    assert.equal(source(report, "hatch", "syrax-gemini").headroom.kind, "counted");
    assert.deepEqual(lane(report, "hatch").serving, hatchLane.rungs.map(rungId));
    assert.equal(source(report, "front", "syrax-gemini").headroom.kind, "unknown");
  });

  it("says unknown with the time it was last understood, never nothing moved", () => {
    const monitor = new LaneMonitor(deployment);
    monitor.telemetry.observe(
      "syrax-mistral",
      headers(mistralSaid),
      new Date("2026-08-24T09:00:00Z"),
    );
    monitor.telemetry.observe(
      "syrax-mistral",
      headers(new Map()),
      new Date("2026-08-24T09:05:00Z"),
    );

    const mistral = source(monitor.report(), "front", "syrax-mistral");

    assert.equal(mistral.headroom.kind, "unknown");
    assert.equal(mistral.lastReadAt, "2026-08-24T09:00:00.000Z");
    assert.match(usageReportLine(monitor.report()), /unknown — its telemetry stopped parsing/);
  });

  it("leaves the file whether or not anybody is told, and tells nobody unasked", () => {
    const report = new LaneMonitor(deployment).report();

    const written = JSON.parse(
      readFileSync(usageReportPath(deployment.monitorState), "utf8"),
    ) as UsageReport;
    assert.deepEqual(written, report);
    assert.deepEqual(posts(), []);
  });

  it("reaches System on a transition, and says which one", async () => {
    const monitor = new LaneMonitor(deployment);

    await monitor.announce({
      kind: "a lane switch",
      said: "the front lane fell to its second rung.",
    });

    const posted = posts();
    assert.equal(posted.length, 1);
    assert.equal(posted[0]!.body.message_thread_id, carriers.system);
    assert.equal(posted[0]!.body.chat_id, ownerTelegramUserId);
    assert.match(
      String(posted[0]!.body.text),
      /a lane switch: the front lane fell to its second rung/,
    );
    assert.match(String(posted[0]!.body.text), /\*\*front\*\*/);
  });

  it("posts a rationed spend, and stays silent about a refusal that spent nothing", async () => {
    const monitor = new LaneMonitor(deployment);
    const reach = monitor.tools().find((tool) => tool.name === "reach")!;

    await reach.call({ question: "a hard one", askedFor: "  " });
    assert.deepEqual(posts(), [], "a refusal that spends nothing posted anyway.");

    await reach.call({ question: "a hard one", askedFor });

    assert.equal(posts().length, 1);
    assert.match(String(posts()[0]!.body.text), /a rationed spend/);
    assert.match(String(posts()[0]!.body.text), /19 of 20 on syrax-gemini/);
  });

  it("is asked for without posting, and leaves the carrier map as it found it", async () => {
    const monitor = new LaneMonitor(deployment);
    const report = monitor.tools().find((tool) => tool.name === "report")!;

    await report.call({});

    assert.deepEqual(posts(), []);
    assert.deepEqual(readCarrierMap(deployment.carrierMap), carriers);
  });
});
