/**
 * What reaches the System chat when the benchmark has been scored, read at the Telegram wire. The
 * search unit stands behind a local stub of its own `/benchmark` route: what is under test is the
 * delivery rule — exceptions-only, and once per scoring run — and not the arithmetic, which is the
 * unit's and is tested there.
 *
 * The unattended half is driven at the file the unit writes rather than at that route, which is the
 * seam it actually reads: a beat that scored the set again would show up here as a request the stub
 * counted.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname } from "node:path";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { writeCarrierMap, type CarrierMap } from "../src/adapter/carriers.ts";
import { readDeployment, type Deployment } from "../src/adapter/deployment.ts";
import { generateConfig } from "../src/adapter/generator.ts";
import { LaneMonitor } from "../src/monitor/lane-monitor.ts";
import {
  deliverScoredRetrieval,
  retrievalReportPath,
  scoreAndDeliverRetrieval,
} from "../src/monitor/retrieval-delivery.ts";
import {
  isWorthPosting,
  retrievalReportLine,
  type RetrievalReport,
} from "../src/surface/retrieval-report.ts";
import { writeSecretsStore } from "./gateway.ts";
import { temporaryMachine } from "./machine.ts";
import { TelegramStub } from "./stubs/telegram-bot-api.ts";

const botToken = "6100000000:STUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTU";

function scored(overrides: Partial<RetrievalReport> = {}): RetrievalReport {
  return {
    scored_at: "2026-08-25T04:31:07+00:00",
    numbers: {
      scored: 12,
      found: 10,
      first: 8,
      total: 19,
      fixture: 15,
      live: 4,
      pending: 3,
      retired: 0,
      refitted_confident_floor: 0.141,
    },
    confident_floor: {
      pinned: 0.12,
      refitted: 0.141,
      best_wrong: 0.138,
      worst_right: 0.149,
      applied: false,
    },
    pending_queries: ["MH1101 25/26 Final"],
    failed: null,
    moved: ["found"],
    ...overrides,
  };
}

describe("the retrieval report", () => {
  let telegram: TelegramStub;
  let unit: Server;
  let deployment: Deployment;
  let served: RetrievalReport | number = scored();
  let scorings = 0;

  before(async () => {
    telegram = await TelegramStub.start(botToken);
    unit = createServer((request, response) => {
      scorings++;
      if (typeof served === "number") {
        response.writeHead(served).end("no");
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(served));
    });
    await new Promise<void>((resolve) => unit.listen(0, "127.0.0.1", resolve));
  });

  after(async () => {
    await telegram?.close();
    await new Promise<void>((resolve) => unit.close(() => resolve()));
  });

  beforeEach(() => {
    const machine = temporaryMachine();
    deployment = readDeployment({
      ...machine.deployment,
      secretsStore: writeSecretsStore(machine.deployment.secretsStore as string, botToken),
      telegramApiRoot: telegram.apiRoot,
      searchPort: (unit.address() as AddressInfo).port,
    });
    const carriers: CarrierMap = { system: telegram.createTopic() };
    writeCarrierMap(deployment.carrierMap, carriers);
    generateConfig(deployment, carriers);
  });

  afterEach(() => {
    served = scored();
    scorings = 0;
  });

  /** What the search unit's own pass leaves behind, which is what the beat delivers. */
  function passWrote(report: RetrievalReport): void {
    const path = retrievalReportPath(deployment);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  }

  function posts(): { text: string; message_thread_id?: number }[] {
    return telegram.calls
      .filter((call) => call.method === "sendMessage")
      .map((call) => call.body as { text: string; message_thread_id?: number });
  }

  it("posts into System when a number moved", async () => {
    const before = posts().length;
    await scoreAndDeliverRetrieval(deployment);

    const posted = posts().slice(before);
    assert.equal(posted.length, 1);
    assert.match(posted[0]!.text, /^Retrieval:/);
  });

  it("says nothing at all when nothing moved", async () => {
    served = scored({ moved: [] });
    const before = posts().length;

    const { report } = await scoreAndDeliverRetrieval(deployment);
    assert.equal(isWorthPosting(report!), false);
    assert.deepEqual(posts().slice(before), []);
  });

  it("posts a run that failed, and the numbers it left standing", async () => {
    served = scored({ moved: [], failed: "RuntimeError: the export is not where it was" });
    const before = posts().length;

    await scoreAndDeliverRetrieval(deployment);
    assert.match(posts().slice(before)[0]!.text, /the run failed — RuntimeError/);
  });

  it("treats a search unit that does not answer as a run that failed", async () => {
    served = 503;
    const before = posts().length;

    const { report } = await scoreAndDeliverRetrieval(deployment);
    assert.match(report?.failed ?? "", /the search unit did not score the set/);
    assert.equal(posts().slice(before).length, 1);
  });

  it("states the re-fitted floor beside the pinned one, with the counts that make it legible", () => {
    const line = retrievalReportLine(scored());

    assert.match(line, /pinned at 0\.12/);
    assert.match(line, /re-fit to 0\.141/);
    assert.match(line, /15 fixture and 4 live entries with 3 pending/);
  });

  it("says a floor was not applied rather than leaving it to be assumed", () => {
    assert.match(retrievalReportLine(scored()), /Nothing was changed/);
  });

  it("says so where the set holds nothing to re-fit against", () => {
    const line = retrievalReportLine(
      scored({ confident_floor: { ...scored().confident_floor, refitted: null } }),
    );
    assert.match(line, /nothing to re-fit it against/);
  });
  it("reaches System without anybody running a command, and scores nothing to do it", async () => {
    passWrote(scored());
    const before = posts().length;

    const delivered = await deliverScoredRetrieval(deployment);

    assert.equal(delivered.posted, true);
    assert.equal(posts().slice(before).length, 1);
    assert.equal(scorings, 0, "the beat scored the set again instead of delivering the run.");
  });

  it("stays silent unattended when nothing moved and no run failed", async () => {
    passWrote(scored({ moved: [] }));
    const before = posts().length;

    const delivered = await deliverScoredRetrieval(deployment);

    assert.equal(delivered.posted, false);
    assert.deepEqual(posts().slice(before), []);
  });

  it("delivers one scoring run once, however often the beat fires", async () => {
    passWrote(scored());
    const before = posts().length;

    for (let beat = 0; beat < 4; beat++) await deliverScoredRetrieval(deployment);

    assert.equal(posts().slice(before).length, 1);
  });

  it("delivers the next run once a pass has written one", async () => {
    passWrote(scored());
    await deliverScoredRetrieval(deployment);
    const before = posts().length;

    passWrote(scored({ scored_at: "2026-08-28T04:33:19+00:00", moved: ["first"] }));
    await deliverScoredRetrieval(deployment);

    assert.equal(posts().slice(before).length, 1);
  });

  it("delivers a run that failed, since that is the other thing worth hearing", async () => {
    passWrote(scored({ moved: [], failed: "RuntimeError: the export is not where it was" }));
    const before = posts().length;

    await deliverScoredRetrieval(deployment);

    assert.match(posts().slice(before)[0]!.text, /the run failed — RuntimeError/);
  });

  it("says nothing at all where no pass has written a report yet", async () => {
    const before = posts().length;

    const delivered = await deliverScoredRetrieval(deployment);

    assert.equal(delivered.report, null);
    assert.deepEqual(posts().slice(before), []);
  });

  it("delivers one run once when two beats overlap, since a send has no deadline", async () => {
    passWrote(scored());
    const monitor = new LaneMonitor(deployment);
    const before = posts().length;

    await Promise.all([monitor.deliverRetrieval(), monitor.deliverRetrieval()]);

    assert.equal(posts().slice(before).length, 1);
  });

  it("does not deliver a second time what the command already posted", async () => {
    await scoreAndDeliverRetrieval(deployment);
    const before = posts().length;

    passWrote(scored());
    await deliverScoredRetrieval(deployment);

    assert.deepEqual(posts().slice(before), []);
  });
});
