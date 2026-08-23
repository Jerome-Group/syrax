/**
 * MCP over loopback, in the shape the search unit is already reached in (ADR-0005): a resident
 * process the agents connect to, rather than a server each of them spawns. The hatch's counters are
 * the reason — four child processes would be four allowances.
 *
 * Only the streamable-HTTP request half is served. There is no server-initiated stream here because
 * nothing this unit holds arrives unasked: a tool call is a request with an answer, and the usage
 * report reaches the Owner through the chat surface rather than through a connection a model holds.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

export type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call(argumentsGiven: Record<string, unknown>): Promise<unknown>;
};

type Rpc = {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
};

const protocolVersion = "2025-06-18";

export function mcpEndpoint(serverName: string, tools: Tool[]) {
  return async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "POST") {
      // A client asking to open a stream is told there is none rather than left waiting on one.
      return send(response, 405, { error: "this endpoint answers POST only" });
    }
    const message = await readJson(request);
    if (message === null) {
      return send(response, 400, rpcError(null, -32700, "the body is not JSON"));
    }
    // A notification carries no id and expects no answer; `initialized` is the one that arrives.
    if (message.id === undefined) return send(response, 202, null);
    return send(response, 200, await answer(message, serverName, tools));
  };
}

async function answer(message: Rpc, serverName: string, tools: Tool[]): Promise<unknown> {
  const id = message.id ?? null;
  if (message.method === "initialize") {
    return result(id, {
      protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: serverName, version: "1.0.0" },
    });
  }
  if (message.method === "tools/list") {
    return result(id, {
      tools: tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
    });
  }
  if (message.method === "tools/call") {
    const asked = String(message.params?.name ?? "");
    const tool = tools.find((one) => one.name === asked);
    if (tool === undefined) return rpcError(id, -32602, `there is no tool called ${asked}`);
    const given = (message.params?.arguments ?? {}) as Record<string, unknown>;
    return result(id, asContent(await tool.call(given)));
  }
  return rpcError(id, -32601, `${message.method} is not a method this server answers`);
}

/**
 * A tool answers with data, and MCP carries text — so the structured answer rides both fields:
 * `structuredContent` for a client that reads it and the same JSON as text for one that does not.
 */
function asContent(answered: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(answered) }],
    structuredContent: answered,
  };
}

function result(id: number | string | null, payload: unknown) {
  return { jsonrpc: "2.0", id, result: payload };
}

function rpcError(id: number | string | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function readJson(request: IncomingMessage): Promise<Rpc | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Rpc;
  } catch {
    return null;
  }
}

function send(response: ServerResponse, status: number, payload: unknown): void {
  if (payload === null) {
    response.writeHead(status);
    response.end();
    return;
  }
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}
