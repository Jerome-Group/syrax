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

/** A refusal for size, in the shape the provider words one and the runtime passes it through. */
function refusalLine(
  at: string,
  candidate: string,
  requested: number,
  limit: number,
  status = 413,
): string {
  const [provider, ...model] = candidate.split("/");
  return JSON.stringify({
    0: '{"subsystem":"model-fallback/decision"}',
    1: {
      event: "model_fallback_decision",
      lane: "main",
      decision: "candidate_failed",
      requestedProvider: provider,
      requestedModel: model.join("/"),
      candidateProvider: provider,
      candidateModel: model.join("/"),
      // A `413` carrying `rate_limit` is what #204 measured: the runtime's overflow detector
      // refuses any message naming tokens per minute, so a size refusal takes the rate-limit path.
      reason: "rate_limit",
      status,
      providerErrorMessagePreview: `Request too large for model. Limit ${limit}, Requested ${requested}, on tokens per minute (TPM).`,
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

  it("says when a rung was asked for more than its own file says it is ever asked for", () => {
    const { root, deployment } = temporaryMachine();
    const log = join(root, "openclaw.log");
    const rung = frontLane.rungs.find((each) => each.perRequestCeilingTokens !== null)!;
    // The refusal #204 watched, in the provider's own words: the total charged is the call plus
    // what this rung reserves, so a `Requested` this far over says the written figure is stale.
    const asked = rung.largestCallTokens + rung.maxTokens + 1600;
    writeFileSync(
      log,
      `${refusalLine("2026-08-24T09:00:00Z", modelRef(rung), asked, rung.perRequestCeilingTokens!)}\n`,
    );
    const watch = new RungWatch(deployment.monitorState as string, log);

    const found = watch.watch([]);
    const quiet = watch.watch([]);

    assert.deepEqual(
      found.map((one) => one.kind),
      ["an outgrown call size"],
    );
    assert.match(found[0]!.said, new RegExp(`${rung.largestCallTokens}`));
    assert.match(found[0]!.said, new RegExp(`${asked - rung.maxTokens}`));
    assert.deepEqual(quiet, [], "a figure nobody has corrected was announced twice.");
    assert.deepEqual(
      watch.outgrown().map((one) => ({ rung: one.rung, wrote: one.wrote, saw: one.saw })),
      [{ rung: modelRef(rung), wrote: rung.largestCallTokens, saw: asked - rung.maxTokens }],
    );
  });

  it("leaves a bucket 429 alone, which is worded like a wall and is not one", () => {
    const { root, deployment } = temporaryMachine();
    const log = join(root, "openclaw.log");
    const rung = frontLane.rungs.find((each) => each.perRequestCeilingTokens !== null)!;
    // The provider's own rate-limit wording, which names `Requested` exactly as a size refusal
    // does. Only the status separates them, and a context overflow is worded alike again.
    writeFileSync(
      log,
      `${refusalLine("2026-08-24T09:00:00Z", modelRef(rung), rung.perRequestCeilingTokens! + 4000, rung.perRequestCeilingTokens!, 429)}\n`,
    );
    const watch = new RungWatch(deployment.monitorState as string, log);

    assert.deepEqual(watch.watch([]), [], "a rate limit was read as a call outgrowing its figure.");
    assert.deepEqual(watch.outgrown(), []);
  });

  it("reads a grouped number, and one the shorter preview truncated away", () => {
    const { root, deployment } = temporaryMachine();
    const log = join(root, "openclaw.log");
    const rung = frontLane.rungs.find((each) => each.perRequestCeilingTokens !== null)!;
    const asked = rung.largestCallTokens + rung.maxTokens + 1600;
    const grouped = asked.toLocaleString("en-US");
    writeFileSync(
      log,
      `${JSON.stringify({
        0: '{"subsystem":"model-fallback/decision"}',
        1: {
          event: "model_fallback_decision",
          decision: "candidate_failed",
          requestedProvider: rung.provider,
          requestedModel: rung.modelId,
          candidateProvider: rung.provider,
          candidateModel: rung.modelId,
          reason: "rate_limit",
          status: 413,
          // The runtime cuts this one at 200 characters from the head, so the number falls off it.
          providerErrorMessagePreview: `Request too large for model \`${rung.modelId}\` in organization org-${"0".repeat(48)} service tier \`on_demand\` on tokens per minute (TPM): Limit ${rung.perRequestCeilingTokens}, Re`,
          errorPreview: `Request too large for model \`${rung.modelId}\` in organization org-${"0".repeat(48)} service tier \`on_demand\` on tokens per minute (TPM): Limit ${rung.perRequestCeilingTokens}, Requested ${grouped}.`,
        },
        2: "model fallback decision",
        time: "2026-08-24T09:00:00Z",
      })}\n`,
    );
    const watch = new RungWatch(deployment.monitorState as string, log);

    assert.deepEqual(
      watch.watch([]).map((one) => one.kind),
      ["an outgrown call size"],
      `${grouped} was not read: a grouped number, or one the 200-character preview cut off.`,
    );
    assert.equal(watch.outgrown()[0]!.saw, asked - rung.maxTokens);
  });

  it("leaves a figure alone when the refusal is one the written call size already covers", () => {
    const { root, deployment } = temporaryMachine();
    const log = join(root, "openclaw.log");
    const rung = frontLane.rungs.find((each) => each.perRequestCeilingTokens !== null)!;
    writeFileSync(
      log,
      `${refusalLine("2026-08-24T09:00:00Z", modelRef(rung), rung.largestCallTokens + rung.maxTokens, rung.perRequestCeilingTokens!)}\n`,
    );
    const watch = new RungWatch(deployment.monitorState as string, log);

    assert.deepEqual(
      watch.watch([]),
      [],
      "a call the figure covers was reported as outgrowing it.",
    );
    assert.deepEqual(watch.outgrown(), []);
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
