/**
 * The rung watch at the file it reads and the wire it reports on. The log is the runtime's own and
 * its shape is nobody's contract, so the half that matters is measured against a **real gateway**
 * writing a real decision: a rung that answers to no such name, and the lane moving off it.
 *
 * The cursor is measured on a file this suite writes, because what has to be true there is what
 * happens when the log is replaced under the reader — which a running gateway will not do to order.
 */

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { frontLane } from "../src/adapter/front-lane.ts";
import { modelRef } from "../src/adapter/lane.ts";
import { runtimeLogPath } from "../src/adapter/runtime-log.ts";
import { readDecisions } from "../src/monitor/fallback-log.ts";
import { LaneMonitor } from "../src/monitor/lane-monitor.ts";
import { RungWatch } from "../src/monitor/rung-watch.ts";
import { runtimeIsInstalled, standSyrax } from "./gateway.ts";
import { ownerTelegramUserId, temporaryMachine } from "./machine.ts";
import type { OutboundCall } from "./stubs/telegram-bot-api.ts";

const gemini = "gemini-3.5-flash-lite";
const mistral = "ministral-3b-latest";
const gone = "The model `gemini-3.5-flash-lite` does not exist. The paid version is available now.";

/** One line of the runtime's log, in the shape the pinned runtime writes it. */
function decisionLine(at: string, decision: string, candidate: string, reason?: string): string {
  const [provider, ...model] = candidate.split("/");
  return JSON.stringify({
    0: '{"subsystem":"model-fallback/decision"}',
    1: {
      event: "model_fallback_decision",
      lane: "main",
      decision,
      requestedProvider: "syrax-gemini",
      requestedModel: gemini,
      candidateProvider: provider,
      candidateModel: model.join("/"),
      ...(reason === undefined ? {} : { reason, status: 404, errorPreview: gone }),
    },
    2: "model fallback decision",
    time: at,
  });
}

describe("the fallback-decision reader", () => {
  it("reads what it has not read before, and nothing twice", () => {
    const { root } = temporaryMachine();
    const log = join(root, "openclaw.log");
    writeFileSync(
      log,
      `${decisionLine("2026-08-24T09:00:00Z", "candidate_succeeded", `syrax-mistral/${mistral}`)}\n`,
    );

    const first = readDecisions(log, null, new Date("2026-08-24T09:01:00Z"));
    writeFileSync(
      log,
      `${decisionLine("2026-08-24T09:02:00Z", "candidate_failed", `syrax-gemini/${gemini}`, "model_not_found")}\n`,
      { flag: "a" },
    );
    const second = readDecisions(log, first.cursor, new Date("2026-08-24T09:03:00Z"));

    assert.deepEqual(
      first.decisions.map((one) => one.decision),
      ["candidate_succeeded"],
    );
    assert.deepEqual(
      second.decisions.map((one) => one.decision),
      ["candidate_failed"],
    );
    assert.equal(second.decisions[0]!.said, gone);
    assert.equal(second.window.from, "2026-08-24T09:01:00.000Z");
    assert.equal(second.window.unknown, null);
  });

  it("leaves a half-written line for the next read rather than losing it", () => {
    const { root } = temporaryMachine();
    const log = join(root, "openclaw.log");
    const line = decisionLine(
      "2026-08-24T09:00:00Z",
      "candidate_succeeded",
      `syrax-mistral/${mistral}`,
    );
    writeFileSync(log, line.slice(0, 40));

    const first = readDecisions(log, null, new Date());
    writeFileSync(log, `${line.slice(40)}\n`, { flag: "a" });
    const second = readDecisions(log, first.cursor, new Date());

    assert.deepEqual(first.decisions, []);
    assert.equal(second.decisions.length, 1);
  });

  it("says what it could not cover: a log rewritten under it, and one never read", () => {
    const { root } = temporaryMachine();
    const log = join(root, "openclaw.log");
    const first = decisionLine(
      "2026-08-24T09:00:00Z",
      "candidate_succeeded",
      `syrax-mistral/${mistral}`,
    );
    writeFileSync(log, `${first}\n`);
    const read = readDecisions(log, null, new Date());
    assert.match(String(read.window.unknown), /never been read/);

    // Rewritten in place and to the same length, so neither of ADR-0012's two keys can see it: the
    // inode is the one the reader last saw, and the file is not shorter than the offset into it.
    // What catches it is the print of the bytes the last read left behind.
    const second = decisionLine(
      "2026-08-24T10:00:00Z",
      "candidate_succeeded",
      `syrax-mistral/${mistral}`,
    );
    assert.equal(second.length, first.length, "the two lines must be the same length to prove it.");
    writeFileSync(log, `${second}\n`);
    const rewritten = readDecisions(log, read.cursor, new Date());

    assert.match(String(rewritten.window.unknown), /no longer holds/);
    assert.equal(rewritten.decisions.length, 1, "the rewrite was read from its start.");
    assert.equal(rewritten.decisions[0]!.at, "2026-08-24T10:00:00Z");
  });

  it("reads on from where it stopped when the log is the one it left", () => {
    const { root } = temporaryMachine();
    const log = join(root, "openclaw.log");
    writeFileSync(
      log,
      `${decisionLine("2026-08-24T09:00:00Z", "candidate_succeeded", `syrax-mistral/${mistral}`)}\n`,
    );
    const read = readDecisions(log, null, new Date());
    writeFileSync(
      log,
      `${decisionLine("2026-08-24T09:01:00Z", "candidate_succeeded", `syrax-mistral/${mistral}`)}\n`,
      {
        flag: "a",
      },
    );

    const on = readDecisions(log, read.cursor, new Date());

    assert.equal(on.window.unknown, null, "an untouched log was read as a rewritten one.");
    assert.equal(on.decisions.length, 1);
  });

  it("holds a rotted rung between reads, and lets it go when it answers again", () => {
    const { root, deployment } = temporaryMachine();
    const log = join(root, "openclaw.log");
    const rung = modelRef(frontLane.rungs[0]!);
    writeFileSync(
      log,
      `${decisionLine("2026-08-24T09:00:00Z", "candidate_failed", rung, "model_not_found")}\n`,
    );
    const watch = new RungWatch(deployment.monitorState as string, log);

    const found = watch.watch([]);
    const quiet = watch.watch([]);
    writeFileSync(log, `${decisionLine("2026-08-24T09:05:00Z", "candidate_succeeded", rung)}\n`, {
      flag: "a",
    });
    const back = watch.watch([]);

    assert.deepEqual(
      found.map((one) => one.kind),
      ["a rotted rung"],
    );
    assert.match(found[0]!.said, new RegExp(gone.replaceAll("`", "\\`")));
    assert.deepEqual(quiet, [], "a rung nobody has acted on was announced twice.");
    assert.deepEqual(
      back.map((one) => one.kind),
      ["a recovered rung"],
    );
    assert.deepEqual(watch.rotted(), []);
  });
});

describe("the rung watch over a real gateway", { skip: !runtimeIsInstalled() }, () => {
  it("reads a rung that answers to no such name, and says the lane moved off it", async () => {
    const syrax = await standSyrax({ catalogue: [gemini, mistral] });
    after(() => syrax.stop());
    // The front lane's first rung, gone in the provider's own words, on the turn that reaches it.
    syrax.provider.scriptModel(gemini, { kind: "vanished", message: gone });
    const isAnswer = (call: OutboundCall) => call.body.text === "Answered.";
    syrax.telegram.inject({
      fromUserId: ownerTelegramUserId,
      text: "Which model is this?",
      messageThreadId: syrax.carriers.general,
    });
    await syrax.telegram.waitFor("sendMessage", isAnswer, 60_000);

    // The fixture read it already, and reading a `Deployment` again drops what it derived (#196).
    const monitor = new LaneMonitor(syrax.gateway.deployment);
    const crossed = syrax.telegram.calls.length;
    const moved = await monitor.watchRungs();

    assert.deepEqual([...new Set(moved.map((one) => one.kind))].sort(), [
      "a lane switch",
      "a rotted rung",
    ]);
    assert.match(
      moved.find((one) => one.kind === "a rotted rung")!.said,
      /does not exist. The paid version is available now/,
    );
    assert.match(
      moved.find((one) => one.kind === "a lane switch")!.said,
      new RegExp(`the front lane is answering on syrax-mistral/${mistral}`),
    );
    const posted = syrax.telegram.calls
      .slice(crossed)
      .filter((call) => call.method === "sendMessage");
    assert.equal(posted.length, moved.length, "what moved was not what was posted.");
    assert.match(String(posted[0]!.body.text), /\*\*rungs\*\*/);
    // A first read covers what the file still holds and says so: this one had no earlier read to
    // start from, which is a gap in the window rather than a quiet hour.
    assert.equal(monitor.rungs.window()!.from, null);
    assert.match(String(monitor.rungs.window()!.unknown), /never been read/);
    assert.ok(runtimeLogPath(syrax.gateway.deployment.logsDir).endsWith("openclaw.log"));
  });
});
