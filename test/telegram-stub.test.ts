import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { TelegramStub } from "./stubs/telegram-bot-api.ts";

const telegram = await TelegramStub.start("6100000000:STUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTU");
after(() => telegram.close());

const poll = () =>
  fetch(`${telegram.apiRoot}/bot${telegram.botToken}/getUpdates?offset=1&timeout=30`).then(
    (response) => response.json() as Promise<{ result: unknown[] }>,
  );

describe("the Telegram wire", () => {
  it("routes a call carrying a query string, which long polling always does", async () => {
    const answered = await poll();
    assert.ok(Array.isArray(answered.result));
    assert.equal(
      telegram.calls.some((call) => call.method.includes("?")),
      false,
    );
  });

  it("leaves no poll orphaned when a second one overlaps it", async () => {
    const first = poll();
    const second = poll();
    telegram.inject({ fromUserId: 100000000, text: "Are you there?" });
    const settled = await Promise.race([
      Promise.all([first, second]).then(() => "both settled"),
      new Promise((resolve) => setTimeout(() => resolve("a poll hung"), 5_000)),
    ]);
    assert.equal(settled, "both settled");
  });

  it("hands one injected update to exactly one poll", async () => {
    telegram.inject({ fromUserId: 100000000, text: "Once only." });
    const delivered = await poll();
    assert.equal(delivered.result.length, 1);
    assert.deepEqual((await poll()).result, []);
  });
});
