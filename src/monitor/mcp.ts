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
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
};

const protocolVersion = "2025-06-18";
const maximumBodyBytes = 1024 * 1024;

export function mcpEndpoint(serverName: string, tools: Tool[]) {
  return async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "POST") {
      // A client asking to open a stream is told there is none rather than left waiting on one.
      return send(response, 405, { error: "this endpoint answers POST only" });
    }
    const read = await readJson(request);
    if (!read.ok) return send(response, read.status, rpcError(null, read.code, read.message));
    const message = read.message;
    // A notification carries no id and expects no answer; `initialized` is the one that arrives.
    if (message.id === undefined) return send(response, 202, null);
    try {
      return send(response, 200, await answer(message, serverName, tools));
    } catch (thrown) {
      // A tool that throws is one call that failed, not a unit that goes down under `KeepAlive`
      // holding counters nothing else has — and a client left waiting learns nothing either.
      return send(response, 200, rpcError(message.id, -32603, reason(thrown)));
    }
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
    const given = message.params?.arguments === undefined ? {} : message.params.arguments;
    if (!isRecord(given)) return rpcError(id, -32602, "tool arguments must be an object");
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

function reason(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

type ReadRequest =
  { ok: true; message: Rpc } | { ok: false; status: number; code: number; message: string };

async function readJson(request: IncomingMessage): Promise<ReadRequest> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of request) {
      bytes += (chunk as Buffer).length;
      if (bytes <= maximumBodyBytes) chunks.push(chunk as Buffer);
      else chunks.length = 0;
    }
  } catch {
    return { ok: false, status: 400, code: -32700, message: "the body could not be read" };
  }
  if (bytes > maximumBodyBytes) {
    return { ok: false, status: 413, code: -32600, message: "the body exceeds 1 MiB" };
  }
  let held: unknown;
  try {
    held = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return { ok: false, status: 400, code: -32700, message: "the body is not JSON" };
  }
  if (
    !isRecord(held) ||
    held.jsonrpc !== "2.0" ||
    typeof held.method !== "string" ||
    (held.id !== undefined &&
      held.id !== null &&
      typeof held.id !== "string" &&
      typeof held.id !== "number") ||
    (held.params !== undefined && !isRecord(held.params))
  )
    return { ok: false, status: 400, code: -32600, message: "the body is not a request" };
  return { ok: true, message: held as Rpc };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function send(response: ServerResponse, status: number, payload: unknown): void {
  if (response.destroyed) return;
  if (payload === null) {
    response.writeHead(status);
    response.end();
    return;
  }
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}
