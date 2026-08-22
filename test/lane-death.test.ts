/**
 * A lane dying mid-turn. Both halves are measured against the pinned gateway because both are the
 * runtime's behaviour rather than Syrax's: what Syrax owns is the clock the death is declared on
 * and the chain there is to fall to.
 */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { runtimeIsInstalled, standSyrax, type SyraxFixture } from "./gateway.ts";
import { ownerTelegramUserId } from "./machine.ts";
import { providerIdleTimeoutSeconds, turnCeilingSeconds } from "../src/adapter/timeouts.ts";

const frontPrimary = "gemini-3.5-flash-lite";
const frontSecond = "ministral-3b-latest";

describe("a rung that dies mid-turn", { skip: !runtimeIsInstalled() }, () => {
  let syrax: SyraxFixture;

  after(async () => {
    await syrax?.stop();
  });

  it("is abandoned on the idle clock at the first attempt, and the next rung answers", async () => {
    syrax = await standSyrax({ catalogue: [frontPrimary, frontSecond] });
    syrax.provider.scriptModel(frontPrimary, { kind: "silence" });
    syrax.provider.scriptModel(frontSecond, { kind: "reply", text: "The next rung answered." });

    const started = Date.now();
    syrax.telegram.inject({
      fromUserId: ownerTelegramUserId,
      text: "Are you there?",
      messageThreadId: syrax.carriers.general,
    });
    const answered = await syrax.telegram.waitFor(
      "sendMessage",
      (call) => call.body.text === "The next rung answered.",
      // The whole-turn ceiling, which is what a hang would have to outlast to be one.
      turnCeilingSeconds * 1000,
    );

    assert.ok(answered, "the silent rung was never abandoned.");
    // Bounded by the two clocks Syrax states rather than by a margin: the turn waited for the
    // watchdog, and it finished well inside the ceiling that contains it. A tighter bound than
    // this measures the machine — four gateways start at once when the suite runs its files in
    // parallel — rather than the runtime.
    const waited = (Date.now() - started) / 1000;
    const idle = providerIdleTimeoutSeconds["syrax-gemini"];
    assert.ok(
      waited >= idle,
      `the turn took ${waited.toFixed(1)}s, short of the ${idle}s watchdog.`,
    );
    assert.ok(
      waited < turnCeilingSeconds,
      `the turn took ${waited.toFixed(1)}s, past the ${turnCeilingSeconds}s whole-turn ceiling.`,
    );
    assert.ok(
      syrax.provider.askedModels.includes(frontSecond),
      "the chain never advanced past the silent rung.",
    );
    // The property ADR-0016 wanted and could not get from Groq: a chain that advances rather than
    // retrying a dead rung in place. The runtime refuses the same-rung retry wherever fallbacks
    // are configured, so a rung on a chain is dead at its first idle timeout.
    assert.equal(
      syrax.provider.askedModels.indexOf(frontSecond),
      1,
      "the silent rung was tried again before the chain advanced.",
    );
  });
});

describe("a rung that dies half way through an answer", { skip: !runtimeIsInstalled() }, () => {
  let syrax: SyraxFixture;
  const half = "HALF AN ANSWER: the first three findings are";
  const whole = "The whole answer, from the attempt that finished.";

  after(async () => {
    await syrax?.stop();
  });

  it("is retried by the transport rather than shown, and the half never reaches the Owner", async () => {
    syrax = await standSyrax({ catalogue: [frontPrimary] });
    syrax.provider.scriptModel(
      frontPrimary,
      { kind: "died", text: half },
      { kind: "reply", text: whole },
    );

    syrax.telegram.inject({
      fromUserId: ownerTelegramUserId,
      text: "Answer at length.",
      messageThreadId: syrax.carriers.general,
    });
    await syrax.telegram.waitFor("sendMessage", (call) => call.body.text === whole);

    for (const call of [
      ...syrax.telegram.matching("sendMessage"),
      ...syrax.telegram.matching("editMessageText"),
    ]) {
      assert.ok(
        !String(call.body.text).includes(half),
        `a partial answer reached the Owner: ${String(call.body.text).slice(0, 80)}`,
      );
    }
    // A dropped socket is retried where a silent rung is not: the two failure shapes are handled
    // by different parts of the runtime, and neither count is Syrax's to set.
    assert.equal(
      syrax.provider.askedModels.filter((model) => model === frontPrimary).length,
      2,
      "the rung that dropped its connection was not retried once.",
    );
  });
});
