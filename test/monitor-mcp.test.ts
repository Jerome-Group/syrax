import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { after, describe, it } from "node:test";
import { mcpEndpoint } from "../src/monitor/mcp.ts";

async function endpoint() {
  const serve = mcpEndpoint("test-monitor", [
    {
      name: "echo",
      description: "echo",
      inputSchema: { type: "object" },
      call: async (given) => given,
    },
  ]);
  let completed: (() => void) | undefined;
  let started: (() => void) | undefined;
  const server = createServer((request, response) => {
    started?.();
    void serve(request, response).finally(() => completed?.());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    url,
    nextStarted: () =>
      new Promise<void>((resolve) => {
        started = resolve;
      }),
    nextCompleted: () =>
      new Promise<void>((resolve) => {
        completed = resolve;
      }),
  };
}

async function post(url: string, body: string) {
  const response = await fetch(url, { method: "POST", body });
  return {
    status: response.status,
    body: (await response.json()) as { error?: { code: number }; result?: unknown },
  };
}

describe("monitor request parsing", () => {
  it("reports invalid JSON and envelopes while retaining valid notifications", async () => {
    const { url } = await endpoint();
    assert.equal((await post(url, "{")).body.error?.code, -32700);
    for (const body of [
      null,
      [],
      true,
      { id: 1 },
      { jsonrpc: "2.0", id: {}, method: "initialize" },
      { jsonrpc: "2.0", id: 1, method: "initialize", params: [] },
    ]) {
      const answered = await post(url, JSON.stringify(body));
      assert.equal(answered.status, 400);
      assert.equal(answered.body.error?.code, -32600);
    }
    const notification = await fetch(url, {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    assert.equal(notification.status, 202);
    assert.equal(await notification.text(), "");
    assert.equal(
      (await post(url, JSON.stringify({ jsonrpc: "2.0", id: null, method: "initialize" }))).status,
      200,
    );
  });

  it("rejects bodies above the limit and accepts one at the limit", async () => {
    const { url } = await endpoint();
    const message = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" });
    const atLimit = message.padEnd(1024 * 1024, " ");
    assert.equal((await post(url, atLimit)).status, 200);
    const aboveLimit = await post(url, `${atLimit} `);
    assert.equal(aboveLimit.status, 413);
    assert.equal(aboveLimit.body.error?.code, -32600);
  });

  it("requires tool arguments to be objects", async () => {
    const { url } = await endpoint();
    for (const given of [null, [], "text", 7]) {
      const answered = await post(
        url,
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "echo", arguments: given },
        }),
      );
      assert.equal(answered.body.error?.code, -32602);
    }
    const valid = await post(
      url,
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "echo", arguments: { value: 7 } },
      }),
    );
    assert.ok(valid.body.result);
  });

  it("settles an interrupted request and remains available", async () => {
    const { url, nextCompleted, nextStarted } = await endpoint();
    const finished = nextCompleted();
    const started = nextStarted();
    const client = httpRequest(url, { method: "POST", headers: { "content-length": "100" } });
    client.on("error", () => {});
    client.write("{");
    await started;
    client.destroy();
    await finished;
    assert.equal(
      (await post(url, JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }))).status,
      200,
    );
  });
});
