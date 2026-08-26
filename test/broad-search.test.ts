/**
 * What a search actually puts on the Telegram wire: a document, a shortlist of three and a tap that
 * comes back for one of them.
 *
 * The model is scripted here, so what is under test is the **surface** rather than the model's
 * judgement — that the configuration lets the front lane send a file and a keyboard at all, and that
 * the pinned runtime still behaves the way General's standing instruction assumes it does. Both are
 * things that break silently: a keyboard drops out of an edit, a document is refused for its path,
 * and the chat looks like it is merely answering badly.
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { agentWorkspace } from "../src/adapter/agent-defaults.ts";
import { chats } from "../src/adapter/chats.ts";
import { runtimeIsInstalled, standSyrax, type SyraxFixture } from "./gateway.ts";
import { ownerTelegramUserId } from "./machine.ts";
import type { OutboundCall } from "./stubs/telegram-bot-api.ts";

/** What the shortlist's buttons carry, as the search unit mints them: a token and a position. */
const shortlist = {
  candidates: ["wedderburn.md", "quiver.md", "hardware store receipt.pdf"],
  choices: ["kP3xVq1a:0", "kP3xVq1a:1", "kP3xVq1a:2"],
  decline: "kP3xVq1a:none",
};

/** The message body a close call writes: the names, numbered, where they have room to be read. */
const numbered = shortlist.candidates.map((name, at) => `${at + 1}. ${name}`).join("\n");

const carriesAKeyboard = (call: OutboundCall) => call.body.reply_markup !== undefined;

describe("General answering with the corpus", { skip: !runtimeIsInstalled() }, () => {
  let syrax: SyraxFixture;
  let handedOver: string;

  before(async () => {
    syrax = await standSyrax({ standingReply: "Answered." });
    // Where `attach` puts a document is the one thing this suite stands in for: the search unit is
    // not running here, and the runtime uploads a local file only from roots it owns.
    handedOver = join(agentWorkspace(syrax.gateway.deployment, chats.general), "wedderburn.md");
    writeFileSync(handedOver, "artin wedderburn theorem semisimple rings");
  });

  after(async () => {
    await syrax?.stop();
  });

  /**
   * Scripts one tool call, asks General for something, and returns the call it was supposed to put
   * on the wire. A turn is read by what it sent rather than by its reply, because the runtime makes
   * calls of its own around one — and a turn that sent nothing fails here rather than three tests
   * later.
   */
  async function turn(
    text: string,
    args: Record<string, unknown>,
    awaited: { method: string; predicate?: (call: OutboundCall) => boolean },
  ): Promise<OutboundCall> {
    const predicate = awaited.predicate ?? (() => true);
    const already = syrax.telegram.matching(awaited.method, predicate).length;
    syrax.provider.script({ kind: "toolCall", name: "message", arguments: args });
    syrax.telegram.inject({
      fromUserId: ownerTelegramUserId,
      text,
      messageThreadId: syrax.carriers.general,
    });
    return await syrax.telegram.waitFor(awaited.method, predicate, 60_000, already);
  }

  /** The tap reaches the model as an ordinary message, so the prompt carrying it is the evidence. */
  async function promptCarrying(from: number, carried: string): Promise<string> {
    const deadline = Date.now() + 60_000;
    for (;;) {
      const found = syrax.provider.requests
        .slice(from)
        .map((request) => JSON.stringify(request.body))
        .find((body) => body.includes(carried));
      if (found !== undefined) return found;
      if (Date.now() > deadline) throw new Error(`No prompt carried ${carried}.`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  it("answers a described document with the document itself", async () => {
    const documents = syrax.telegram.matching("sendDocument", () => true).length;
    const sent = await turn(
      "the notes about semisimple rings",
      { action: "send", message: "Wedderburn.", mediaUrl: handedOver },
      { method: "sendDocument" },
    );

    assert.equal(sent.body.document, "wedderburn.md");
    assert.equal(sent.body.caption, "Wedderburn.");
    assert.equal(sent.body.message_thread_id, syrax.carriers.general);

    // The tool on its own is the clean delivery the instruction now asks for: one document, and no
    // warning trailing it. The two tests below are what happens when a turn does not stop here.
    await syrax.telegram.quiet();
    assert.equal(
      syrax.telegram.matching("sendDocument", () => true).length - documents,
      1,
      "one `message` call put the file on the wire more than once.",
    );
    assert.equal(
      syrax.telegram.matching("sendMessage", (call) => call.body.text === "⚠️ Media failed.")
        .length,
      0,
      "the tool route warns about media of its own accord, which the Owner would see every time.",
    );
  });

  /**
   * Why the standing instruction ends a delivery at the tool (#188). The runtime offers two ways to
   * send a file — the `message` tool, or a `MEDIA:` line in the final reply — and they are
   * alternatives rather than layers, which is not something a model reads off either one's
   * description. What that costs is measured here rather than assumed: a turn doing both puts the
   * document on the wire twice where the line resolves, and a bare `⚠️ Media failed.` where it does
   * not, since `NO_REPLY` on its own line is not exactly the token that suppresses a reply.
   *
   * It is scripted, so it proves the runtime rather than the model. Should a runtime bump make a
   * second submission a no-op, this goes red and the instruction has a line it can give back.
   */
  it("hands the same file over twice when a MEDIA line follows the tool that sent it", async () => {
    const sent = syrax.telegram.matching("sendDocument", () => true).length;
    syrax.provider.script(
      {
        kind: "toolCall",
        name: "message",
        arguments: { action: "send", message: "Wedderburn.", mediaUrl: handedOver },
      },
      { kind: "reply", text: `MEDIA:${handedOver}\nNO_REPLY` },
    );
    syrax.telegram.inject({
      fromUserId: ownerTelegramUserId,
      text: "the notes about semisimple rings, again",
      messageThreadId: syrax.carriers.general,
    });
    // Both of them, not the first: this turn is still in flight while the second submission is
    // resolved, and a test that scripts its own reply into that gap gets the standing one instead.
    await syrax.telegram.waitFor("sendDocument", () => true, 60_000, sent + 1);
    await syrax.telegram.quiet();

    assert.equal(
      syrax.telegram.matching("sendDocument", () => true).length - sent,
      2,
      "the MEDIA line stopped costing a second delivery, so the instruction may give the line back.",
    );
  });

  it("reports a MEDIA line it cannot resolve as a message with nothing else in it", async () => {
    await syrax.telegram.quiet();
    const outside = join(mkdtempSync(join(tmpdir(), "syrax-unowned-")), "wedderburn.md");
    writeFileSync(outside, "artin wedderburn theorem semisimple rings");
    const failed = (call: OutboundCall) => call.body.text === "⚠️ Media failed.";
    const already = syrax.telegram.matching("sendMessage", failed).length;
    const documents = syrax.telegram.matching("sendDocument", () => true).length;

    syrax.provider.script({ kind: "reply", text: `MEDIA:${outside}\nNO_REPLY` });
    syrax.telegram.inject({
      fromUserId: ownerTelegramUserId,
      text: "the notes, from somewhere the runtime does not own",
      messageThreadId: syrax.carriers.general,
    });
    const warned = await syrax.telegram.waitFor("sendMessage", failed, 60_000, already);
    await syrax.telegram.quiet();

    // `waitFor` matched on that text, so restating it proves nothing. What is worth asserting is
    // that the warning arrived *instead of* the file and carries nothing but itself: the Owner sees
    // a bare line with no document and no clue which path the runtime would not take.
    assert.equal(
      syrax.telegram.matching("sendDocument", () => true).length,
      documents,
      "the file crossed the wire as well, so the warning is not what the Owner is left with.",
    );
    for (const carrying of ["document", "photo", "video", "audio", "caption"]) {
      assert.equal(
        warned.body[carrying],
        undefined,
        `the warning carries ${carrying}, so it is not the bare line the Owner reported.`,
      );
    }
    assert.equal(warned.body.message_thread_id, syrax.carriers.general);
  });

  /**
   * ADR-0033: a close call is an ordinary message now. Ten buttons carrying opaque tokens was a
   * tool call `gemini-3.5-flash-lite` aborted mid-serialisation and `openai/gpt-oss-120b` failed
   * schema validation on six times, so what reached the Owner was nothing at all. The arguments
   * here are the ones the standing instruction asks for, and that is the point rather than a
   * detail: #198 shipped a test scripting one shape while the instruction described another, and
   * stayed green while the chat was broken.
   */
  it("offers the candidates as one message, numbered, with nothing to tap", async () => {
    const offered = await turn(
      "that thing about algebras",
      {
        action: "send",
        message: `Which of these did you mean?\n\n${numbered}`,
      },
      { method: "sendMessage" },
    );

    // Read as the Owner reads it: the surface formats what looks like a filename, so `wedderburn.md`
    // reaches the wire as `<code>wedderburn.md</code>` and a plain substring is testing the markup.
    const read = String(offered.body.text).replace(/<[^>]+>/g, "");
    for (const [at, name] of shortlist.candidates.entries()) {
      assert.ok(
        read.includes(`${at + 1}. ${name}`),
        `${name} is not on a line the Owner can name.`,
      );
    }
    assert.equal(
      offered.body.reply_markup,
      undefined,
      "a keyboard came back, which is the tool call ADR-0033 removed because it could not be emitted.",
    );
    assert.equal(offered.body.message_thread_id, syrax.carriers.general);
  });

  /**
   * A keyboard of its own rather than a shortlist's, since ADR-0033 took the shortlist's away. What
   * these two prove is the surface — that a tap is acknowledged before anything else crosses the
   * wire, and that an edit drops buttons it does not pass again — and both still hold for the
   * keyboards Syrax does put up: System's *remove this rung*, and the academic pair's two writes.
   */
  async function postAKeyboard(): Promise<OutboundCall> {
    return await turn(
      "put a keyboard up",
      {
        action: "send",
        message: "Tap one.",
        presentation: {
          blocks: [{ type: "buttons", buttons: [{ label: "one", value: shortlist.choices[0] }] }],
        },
      },
      { method: "sendMessage", predicate: carriesAKeyboard },
    );
  }

  it("acknowledges a tap before the work the tap triggers, and hands its value to the chat", async () => {
    const keyboarded = await postAKeyboard();
    await syrax.telegram.quiet();
    const from = syrax.telegram.calls.length;
    const asked = syrax.provider.requests.length;

    syrax.telegram.injectTap({
      fromUserId: ownerTelegramUserId,
      data: shortlist.choices[0]!,
      messageId: keyboarded.messageId!,
      messageThreadId: syrax.carriers.general,
    });
    await syrax.telegram.waitFor("answerCallbackQuery");

    assert.equal(
      syrax.telegram.calls[from]?.method,
      "answerCallbackQuery",
      "something crossed the wire before the tap was acknowledged, and the id expires.",
    );
    const prompt = await promptCarrying(asked, `callback_data: ${shortlist.choices[0]}`);
    assert.match(prompt, /agent=general/, "the tap was answered by a chat that does not own it.");
  });

  it("keeps a keyboard across an edit only where the edit passes it again", async () => {
    const keyboarded = await postAKeyboard();
    const edit = (extra: Record<string, unknown>) => ({
      action: "edit",
      channel: "telegram",
      to: String(ownerTelegramUserId),
      messageId: keyboarded.messageId,
      message: "Sent the first one.",
      ...extra,
    });

    const kept = await turn(
      "keep them",
      edit({
        presentation: {
          blocks: [{ type: "buttons", buttons: [{ label: "one", value: shortlist.choices[0] }] }],
        },
      }),
      { method: "editMessageText", predicate: carriesAKeyboard },
    );
    const dropped = await turn("drop them", edit({}), {
      method: "editMessageText",
      predicate: (call) => !carriesAKeyboard(call),
    });

    assert.equal(kept.body.message_id, keyboarded.messageId);
    assert.equal(
      dropped.body.reply_markup,
      undefined,
      "an edit that passed no buttons kept them, so the standing instruction guards nothing.",
    );
  });
});
