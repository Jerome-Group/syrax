/**
 * The front/worker split as the Owner meets it: which lane answers, what the chat shows while the
 * slow lane works, and what a turn that delegates nothing looks like. It drives the pinned gateway
 * at both wires, so what it measures is the runtime's own surface rather than this repository's
 * idea of one.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { runtimeIsInstalled, standSyrax, type SyraxFixture } from "./gateway.ts";
import { ownerTelegramUserId } from "./machine.ts";

const frontModel = "gemini-3.5-flash-lite";
const workerModel = "gemini-3.1-flash-lite";
const workerAnswer = "The worker's own words, which are the answer.";

describe("a delegating turn", { skip: !runtimeIsInstalled() }, () => {
  let syrax: SyraxFixture;

  before(async () => {
    syrax = await standSyrax({ catalogue: [frontModel, workerModel] });
    syrax.provider.scriptModel(
      frontModel,
      { kind: "toolCall", name: "sessions_spawn", arguments: { task: "Read the long thing." } },
      // The second step is slow so that the draft is edited while the work is still going: one
      // message edited is what is being measured, and an instant turn would never edit it.
      { kind: "toolCall", name: "sessions_yield", arguments: {}, afterMs: 8_000 },
      { kind: "reply", text: workerAnswer },
    );
    // Slower than the front lane's own steps, so the worker is still working when the turn yields.
    syrax.provider.scriptModel(workerModel, { kind: "reply", text: workerAnswer, afterMs: 25_000 });

    syrax.telegram.inject({
      fromUserId: ownerTelegramUserId,
      text: "Read the long thing.",
      messageThreadId: syrax.carriers.general,
    });
    await syrax.telegram.waitFor("sendMessage", (call) => call.body.text === workerAnswer);
  });

  after(async () => {
    await syrax?.stop();
  });

  it("thinks on the worker chain and talks on the front one", () => {
    const asked = syrax.provider.askedModels;
    assert.equal(asked[0], frontModel, "the turn did not start on the front lane.");
    assert.ok(asked.includes(workerModel), `the worker lane was never asked: ${asked.join(", ")}`);
    assert.equal(
      asked.filter((model) => model === workerModel).length,
      1,
      "the worker was asked more than once for one delegated task.",
    );
  });

  it("posts one progress message and edits it, rather than a stack of them", () => {
    const posted = syrax.telegram.matching("sendMessage");
    const drafts = posted.filter((call) => String(call.body.text).includes("Working"));
    assert.equal(drafts.length, 1, "more than one progress message was posted.");
    const edits = syrax.telegram.matching("editMessageText");
    assert.ok(edits.length > 0, "the progress message was never edited.");
    const edited = new Set(edits.map((call) => call.body.message_id));
    assert.equal(edited.size, 1, `${edited.size} drafts were edited, and there should be one.`);
  });

  it("delivers the answer beneath the progress message, never as a replacement for it", () => {
    const answered = syrax.telegram
      .matching("sendMessage")
      .find((call) => call.body.text === workerAnswer);
    assert.ok(answered, "the answer never arrived.");
    for (const edit of syrax.telegram.matching("editMessageText")) {
      assert.notEqual(edit.body.text, workerAnswer, "the draft was edited into the answer.");
    }
  });

  it("passes the worker's output through verbatim", () => {
    const relayed = syrax.provider.requests
      .filter((request) => request.body.model === frontModel)
      .at(-1);
    assert.ok(
      JSON.stringify(relayed?.body.messages).includes(workerAnswer),
      "the front lane was handed something other than what the worker said.",
    );
    const answered = syrax.telegram
      .matching("sendMessage")
      .some((call) => call.body.text === workerAnswer);
    assert.ok(answered, "what reached the Owner was not the worker's own words.");
  });
});

describe("a turn that delegates nothing", { skip: !runtimeIsInstalled() }, () => {
  let syrax: SyraxFixture;

  after(async () => {
    await syrax?.stop();
  });

  it("shows a typing indicator and no message, however long it takes", async () => {
    syrax = await standSyrax({ catalogue: [frontModel] });
    // Long enough that a progress draft would have been posted if one were ever coming.
    syrax.provider.scriptModel(frontModel, {
      kind: "reply",
      text: "A plain answer.",
      afterMs: 20_000,
    });

    syrax.telegram.inject({
      fromUserId: ownerTelegramUserId,
      text: "Say something.",
      messageThreadId: syrax.carriers.general,
    });
    const answered = await syrax.telegram.waitFor("sendMessage");

    assert.equal(answered.body.text, "A plain answer.");
    assert.equal(syrax.telegram.matching("sendMessage").length, 1, "a second message was posted.");
    assert.equal(syrax.telegram.matching("editMessageText").length, 0, "a draft was edited.");
    assert.ok(
      syrax.telegram.matching("sendChatAction").some((call) => call.body.action === "typing"),
      "the Owner was shown nothing at all while the lane worked.",
    );
  });
});
