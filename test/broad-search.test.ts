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
import { writeFileSync } from "node:fs";
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
    const sent = await turn(
      "the notes about semisimple rings",
      { action: "send", message: "Wedderburn.", mediaUrl: handedOver },
      { method: "sendDocument" },
    );

    assert.equal(sent.body.document, "wedderburn.md");
    assert.equal(sent.body.caption, "Wedderburn.");
    assert.equal(sent.body.message_thread_id, syrax.carriers.general);
  });

  it("offers three tappable candidates and a way to want none of them", async () => {
    const offered = await turn(
      "that thing about algebras",
      {
        action: "send",
        message: "Three of these look close.",
        presentation: {
          blocks: [
            { type: "text", text: "Three of these look close." },
            {
              type: "buttons",
              buttons: [
                ...shortlist.candidates.map((label, at) => ({
                  label,
                  value: shortlist.choices[at],
                })),
                { label: "None of these", value: shortlist.decline },
              ],
            },
          ],
        },
      },
      { method: "sendMessage", predicate: carriesAKeyboard },
    );

    const keyboard = (offered.body.reply_markup as { inline_keyboard: { text: string }[][] })
      .inline_keyboard;
    assert.deepEqual(
      keyboard.flat().map((button) => button.text),
      [...shortlist.candidates, "None of these"],
    );
    assert.equal(offered.body.message_thread_id, syrax.carriers.general);
  });

  it("acknowledges a tap before the work the tap triggers, and hands its value to the chat", async () => {
    const keyboarded = syrax.telegram.matching("sendMessage", carriesAKeyboard).at(-1)!;
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
    const keyboarded = syrax.telegram.matching("sendMessage", carriesAKeyboard).at(-1)!;
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
