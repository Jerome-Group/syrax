import assert from "node:assert/strict";
import { createServer } from "node:http";
import { it } from "node:test";
import { BotApi } from "../src/surface/bot-api.ts";

it("bounds an unresponsive Telegram request with a thirty-second deadline", async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.write('{"ok":true,"result":');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const timeout = AbortSignal.timeout;
  let requested = 0;
  t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    requested = milliseconds;
    return timeout(50);
  });
  const api = new BotApi(`http://127.0.0.1:${address.port}`, "synthetic-token");
  await assert.rejects(api.sendMessage(1, "synthetic message"), { name: "TimeoutError" });
  assert.equal(requested, 30_000);
});
