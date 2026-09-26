import assert from "node:assert/strict";
import { it } from "node:test";
import { TelegramStub } from "./stubs/telegram-bot-api.ts";

it("does not deliver the next update to an aborted long poll", async () => {
  const telegram = await TelegramStub.start("6100000000:STUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTU");
  try {
    const url = `${telegram.apiRoot}/bot${telegram.botToken}/getUpdates`;
    async function waitForPolls(count: number): Promise<void> {
      const deadline = Date.now() + 2000;
      while (telegram.waitingPollCount !== count) {
        assert.ok(Date.now() < deadline, `expected ${count} waiting polls`);
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    const controller = new AbortController();
    const abandoned = fetch(url, { signal: controller.signal }).catch(() => undefined);
    await waitForPolls(1);
    controller.abort();
    await abandoned;
    await waitForPolls(0);
    telegram.inject({ fromUserId: 100000000, text: "After restart." });
    const response = await fetch(url);
    const body = (await response.json()) as { result: { message: { text: string } }[] };
    assert.equal(body.result[0]?.message.text, "After restart.");
  } finally {
    await telegram.close();
  }
});
