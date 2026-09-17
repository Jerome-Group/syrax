import assert from "node:assert/strict";
import { it } from "node:test";
import { TelegramStub } from "./stubs/telegram-bot-api.ts";

it("returns delivered topic and message identity across sends and edits", async () => {
  const telegram = await TelegramStub.start("delivery-test-token");
  try {
    const topic = telegram.createTopic();
    async function call(method: string, body: Record<string, unknown> | FormData) {
      const multipart = body instanceof FormData;
      const response = await fetch(`${telegram.apiRoot}/bot${telegram.botToken}/${method}`, {
        method: "POST",
        headers: multipart ? {} : { "content-type": "application/json" },
        body: multipart ? body : JSON.stringify(body),
      });
      const result = (await response.json()) as { ok: boolean; result: Record<string, unknown> };
      assert.equal(result.ok, true);
      return result.result;
    }
    const sent = await call("sendMessage", {
      chat_id: 100000000,
      message_thread_id: topic,
      text: "first",
    });
    assert.equal(sent.message_thread_id, topic);
    assert.equal(sent.is_topic_message, true);
    const edited = await call("editMessageText", {
      chat_id: 100000000,
      message_id: sent.message_id,
      text: "second",
    });
    assert.equal(edited.message_id, sent.message_id);
    assert.equal(edited.message_thread_id, topic);
    assert.equal(edited.is_topic_message, true);
    assert.equal(edited.text, "second");
    const root = await call("sendMessage", { chat_id: 100000000, text: "root" });
    assert.equal(root.message_thread_id, undefined);
    assert.equal(root.is_topic_message, undefined);
    for (const method of ["sendDocument", "sendPhoto"]) {
      const form = new FormData();
      form.set("chat_id", "100000000");
      form.set("message_thread_id", String(topic));
      form.set(
        method === "sendDocument" ? "document" : "photo",
        new Blob(["fixture"]),
        "fixture.txt",
      );
      const media = await call(method, form);
      assert.equal(media.message_thread_id, topic);
      assert.equal(media.is_topic_message, true);
    }
  } finally {
    await telegram.close();
  }
});
