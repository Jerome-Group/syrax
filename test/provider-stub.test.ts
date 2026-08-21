import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { ProviderStub } from "./stubs/openai-provider.ts";

const provider = await ProviderStub.start({ catalogue: ["gemini-3.5-flash-lite"] });
after(() => provider.close());

async function complete(body: Record<string, unknown> = {}) {
  return fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gemini-3.5-flash-lite", ...body }),
  });
}

describe("the provider wire", () => {
  it("scripts a 429 whose body names its own quota, which is what a retry-after cannot say", async () => {
    provider.script({
      kind: "rateLimited",
      code: "rate_limit_exceeded",
      message: "Rate limit reached for model in organization on tokens per minute (TPM)",
      retryAfterSeconds: 41,
    });
    const response = await complete();
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "41");
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "rate_limit_exceeded");
  });

  it("scripts a wall, which refuses a request for its size whatever remains", async () => {
    provider.script({ kind: "wall", requestedTokens: 10931, limitTokens: 8000 });
    const response = await complete();
    assert.equal(response.status, 413);
    const body = (await response.json()) as { error: { message: string } };
    assert.match(body.error.message, /Requested 10931, limit 8000/);
  });

  it("scripts an empty catalogue, which is how a rung rots without saying so", async () => {
    provider.setCatalogue([]);
    const response = await fetch(`${provider.baseUrl}/models`);
    assert.deepEqual(((await response.json()) as { data: unknown[] }).data, []);
  });

  it("answers a streaming call, which is how the runtime asks", async () => {
    provider.setCatalogue(["gemini-3.5-flash-lite"]);
    provider.script({ kind: "reply", text: "Standing in." });
    const response = await complete({ stream: true });
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.match(await response.text(), /Standing in\./);
  });
});
