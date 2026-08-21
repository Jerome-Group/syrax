/**
 * The provider wire: an OpenAI-compatible endpoint scripted with the shapes the free tiers were
 * measured producing. A 429 is not one thing — the body's code is what separates an exhausted day
 * from a token bucket — and a wall refuses a request for its size alone, whatever remains.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type ScriptedResponse =
  | { kind: "reply"; text: string }
  | { kind: "rateLimited"; code: string; message: string; retryAfterSeconds: number }
  | { kind: "wall"; requestedTokens: number; limitTokens: number };

export type ProviderRequest = { path: string; body: Record<string, unknown> };

export class ProviderStub {
  readonly requests: ProviderRequest[] = [];
  readonly baseUrl: string;
  #server: Server;
  #catalogue: string[];
  #script: ScriptedResponse[];
  #standingReply: ScriptedResponse;

  constructor(
    server: Server,
    baseUrl: string,
    catalogue: string[],
    standingReply: ScriptedResponse,
  ) {
    this.#server = server;
    this.baseUrl = baseUrl;
    this.#catalogue = catalogue;
    this.#script = [];
    this.#standingReply = standingReply;
  }

  static async start(
    options: {
      catalogue?: string[];
      standingReply?: ScriptedResponse;
    } = {},
  ): Promise<ProviderStub> {
    let stub: ProviderStub;
    const server = createServer((request, response) => {
      void stub.#handle(request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    stub = new ProviderStub(
      server,
      `http://127.0.0.1:${port}`,
      options.catalogue ?? [],
      options.standingReply ?? { kind: "reply", text: "Standing in for a provider." },
    );
    return stub;
  }

  /** Queued responses are served in order; the standing reply answers everything after them. */
  script(...responses: ScriptedResponse[]): void {
    this.#script.push(...responses);
  }

  setCatalogue(models: string[]): void {
    this.#catalogue = models;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.#server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = (request.url ?? "").split("?")[0] ?? "";
    const body = await readJsonBody(request);
    this.requests.push({ path, body });

    if (path.endsWith("/models")) {
      return json(response, 200, {
        object: "list",
        data: this.#catalogue.map((id) => ({ id, object: "model", owned_by: "stub" })),
      });
    }
    if (!path.endsWith("/chat/completions")) return json(response, 404, { error: "not found" });

    const scripted = this.#script.shift() ?? this.#standingReply;
    if (scripted.kind === "rateLimited") {
      response.setHeader("retry-after", String(scripted.retryAfterSeconds));
      return json(response, 429, {
        error: { message: scripted.message, type: "tokens", code: scripted.code },
      });
    }
    if (scripted.kind === "wall") {
      return json(response, 413, {
        error: {
          message: `Request too large: Requested ${scripted.requestedTokens}, limit ${scripted.limitTokens}`,
          type: "tokens",
          code: "request_too_large",
        },
      });
    }

    const model = String(body.model ?? "stub-model");
    if (body.stream === true) return streamCompletion(response, model, scripted.text);
    return json(response, 200, completion(model, scripted.text));
  }
}

function completion(model: string, text: string) {
  return {
    id: "chatcmpl-stub",
    object: "chat.completion",
    created: 1755000000,
    model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function streamCompletion(response: ServerResponse, model: string, text: string): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const chunk = (delta: Record<string, unknown>, finishReason: string | null) =>
    `data: ${JSON.stringify({
      id: "chatcmpl-stub",
      object: "chat.completion.chunk",
      created: 1755000000,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`;
  response.write(chunk({ role: "assistant", content: text }, null));
  response.write(chunk({}, "stop"));
  response.write("data: [DONE]\n\n");
  response.end();
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function json(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}
