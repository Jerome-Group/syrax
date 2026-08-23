/**
 * The provider wire: an OpenAI-compatible endpoint scripted with the shapes the free tiers were
 * measured producing. A 429 is not one thing — the body's code is what separates an exhausted day
 * from a token bucket — and a wall refuses a request for its size alone, whatever remains.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type ScriptedResponse =
  | { kind: "reply"; text: string }
  /** The model asking for a tool, which is how a delegating turn starts. */
  | { kind: "toolCall"; name: string; arguments: Record<string, unknown> }
  /** A rung that has gone silent: the connection is held open and nothing is ever sent. */
  | { kind: "silence" }
  /** A rung that dies mid-answer: this much text arrives, then the connection drops. */
  | { kind: "died"; text: string }
  | { kind: "rateLimited"; code: string; message: string; retryAfterSeconds: number }
  | { kind: "wall"; requestedTokens: number; limitTokens: number };

export type ProviderRequest = { path: string; body: Record<string, unknown> };

/** A scripted response, how long the rung takes to produce it, and what it says about itself. */
export type ScriptedTurn = ScriptedResponse & {
  afterMs?: number;
  /** Rate-limit headers, which three of the four providers send and two send in their own shape. */
  headers?: Record<string, string>;
};

export class ProviderStub {
  readonly requests: ProviderRequest[] = [];
  readonly baseUrl: string;
  #server: Server;
  #catalogue: string[];
  #script: ScriptedTurn[];
  #byModel = new Map<string, ScriptedTurn[]>();
  #standingReply: ScriptedTurn;

  constructor(server: Server, baseUrl: string, catalogue: string[], standingReply: ScriptedTurn) {
    this.#server = server;
    this.baseUrl = baseUrl;
    this.#catalogue = catalogue;
    this.#script = [];
    this.#standingReply = standingReply;
  }

  static async start(
    options: {
      catalogue?: string[];
      standingReply?: ScriptedTurn;
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
  script(...responses: ScriptedTurn[]): void {
    this.#script.push(...responses);
  }

  /**
   * Queued responses for one model, which is how a lane is scripted: a delegating turn puts two
   * models on the wire at once, and what each is asked is the measurement.
   */
  scriptModel(model: string, ...responses: ScriptedTurn[]): void {
    this.#byModel.set(model, [...(this.#byModel.get(model) ?? []), ...responses]);
  }

  /** Every model this stub was asked for, in the order it was asked. */
  get askedModels(): string[] {
    return this.requests
      .filter((request) => request.path.endsWith("/chat/completions"))
      .map((request) => String(request.body.model ?? ""));
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

    const model = String(body.model ?? "stub-model");
    const scripted =
      this.#byModel.get(model)?.shift() ?? this.#script.shift() ?? this.#standingReply;
    if (scripted.kind === "silence") return;
    if (scripted.afterMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, scripted.afterMs));
    }
    for (const [name, value] of Object.entries(scripted.headers ?? {})) {
      response.setHeader(name, value);
    }
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

    if (scripted.kind === "died") return dieMidStream(response, model, scripted.text);
    if (scripted.kind === "toolCall") {
      const call = toolCall(scripted.name, scripted.arguments);
      if (body.stream === true) return streamToolCall(response, model, call);
      return json(response, 200, completion(model, { toolCalls: [call] }));
    }
    if (body.stream === true) return streamCompletion(response, model, scripted.text);
    return json(response, 200, completion(model, { content: scripted.text }));
  }
}

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

let nextToolCallId = 1;

function toolCall(name: string, args: Record<string, unknown>): ToolCall {
  return {
    id: `call_stub_${nextToolCallId++}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

function completion(model: string, message: { content?: string; toolCalls?: ToolCall[] }) {
  return {
    id: "chatcmpl-stub",
    object: "chat.completion",
    created: 1755000000,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: message.content ?? "",
          ...(message.toolCalls === undefined ? {} : { tool_calls: message.toolCalls }),
        },
        finish_reason: message.toolCalls === undefined ? "stop" : "tool_calls",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function streamToolCall(response: ServerResponse, model: string, call: ToolCall): void {
  const chunks = openStream(response, model);
  response.write(
    chunks(
      {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: call.id,
            type: "function",
            function: { name: call.function.name, arguments: call.function.arguments },
          },
        ],
      },
      null,
    ),
  );
  response.write(chunks({}, "tool_calls"));
  response.write("data: [DONE]\n\n");
  response.end();
}

function openStream(response: ServerResponse, model: string) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  return (delta: Record<string, unknown>, finishReason: string | null) =>
    `data: ${JSON.stringify({
      id: "chatcmpl-stub",
      object: "chat.completion.chunk",
      created: 1755000000,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`;
}

function streamCompletion(response: ServerResponse, model: string, text: string): void {
  const chunk = openStream(response, model);
  response.write(chunk({ role: "assistant", content: text }, null));
  response.write(chunk({}, "stop"));
  response.write("data: [DONE]\n\n");
  response.end();
}

/** Half an answer, then the socket goes: what a rung dying mid-turn looks like from here. */
function dieMidStream(response: ServerResponse, model: string, text: string): void {
  const chunk = openStream(response, model);
  response.write(chunk({ role: "assistant", content: text }, null));
  response.socket?.destroy();
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
