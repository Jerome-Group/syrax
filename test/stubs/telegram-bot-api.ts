/**
 * The Telegram wire, standing in for the Bot API. The gateway long-polls it exactly as it polls
 * Telegram, so a test drives routing and lockdown by injecting an update and reading what crossed
 * the wire — never by reaching inside the runtime.
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type OutboundCall = { method: string; body: Record<string, unknown> };

export type InjectedMessage = {
  fromUserId: number;
  text: string;
  chatId?: number;
  messageThreadId?: number;
};

const botIdentity = {
  id: 6100000000,
  is_bot: true,
  first_name: "Syrax",
  username: "syrax_stub_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  has_topics_enabled: true,
};

export class TelegramStub {
  readonly calls: OutboundCall[] = [];
  #pending: unknown[] = [];
  #waitingPoll: ((updates: unknown[]) => void) | null = null;
  #nextUpdateId = 1;
  #nextMessageId = 1000;

  readonly apiRoot: string;
  readonly botToken: string;
  #server: Server;

  constructor(server: Server, apiRoot: string, botToken: string) {
    this.#server = server;
    this.apiRoot = apiRoot;
    this.botToken = botToken;
  }

  static async start(botToken: string): Promise<TelegramStub> {
    let stub: TelegramStub;
    const server = createServer((request, response) => {
      void stub.#handle(request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    stub = new TelegramStub(server, `http://127.0.0.1:${port}`, botToken);
    return stub;
  }

  inject(message: InjectedMessage): void {
    const chatId = message.chatId ?? message.fromUserId;
    this.#deliver({
      update_id: this.#nextUpdateId++,
      message: {
        message_id: this.#nextMessageId++,
        date: 1755000000,
        chat: { id: chatId, type: "private", first_name: "Owner" },
        from: { id: message.fromUserId, is_bot: false, first_name: "Sender" },
        text: message.text,
        ...(message.messageThreadId === undefined
          ? {}
          : { message_thread_id: message.messageThreadId, is_topic_message: true }),
      },
    });
  }

  /** Resolves once a call matching `method` has crossed the wire, or rejects at the deadline. */
  async waitFor(
    method: string,
    predicate: (call: OutboundCall) => boolean = () => true,
    timeoutMs = 120_000,
  ): Promise<OutboundCall> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.calls.find((call) => call.method === method && predicate(call));
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`No ${method} within ${timeoutMs}ms.`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /** Nothing new crossed the wire: still `since` calls of `method` after settling for `quietMs`. */
  async stayedSilent(method: string, quietMs = 8_000, since = 0): Promise<boolean> {
    await new Promise((resolve) => setTimeout(resolve, quietMs));
    return this.calls.filter((call) => call.method === method).length === since;
  }

  async close(): Promise<void> {
    this.#waitingPoll?.([]);
    await new Promise<void>((resolve, reject) =>
      this.#server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  #deliver(update: unknown): void {
    const waiting = this.#waitingPoll;
    if (waiting) {
      this.#waitingPoll = null;
      waiting([update]);
      return;
    }
    this.#pending.push(update);
  }

  async #handle(request: IncomingMessage, response: import("node:http").ServerResponse) {
    const method = (request.url ?? "").split("/").pop() ?? "";
    const body = await readJsonBody(request);

    if (method === "getUpdates") {
      const updates = await this.#collectUpdates();
      return respond(response, updates);
    }

    this.calls.push({ method, body });

    if (method === "getMe") return respond(response, botIdentity);
    if (method === "sendMessage" || method === "editMessageText") {
      return respond(response, {
        message_id: this.#nextMessageId++,
        date: 1755000000,
        chat: { id: body.chat_id, type: "private" },
        from: botIdentity,
        text: body.text,
      });
    }
    return respond(response, true);
  }

  async #collectUpdates(): Promise<unknown[]> {
    if (this.#pending.length > 0) {
      const updates = this.#pending;
      this.#pending = [];
      return updates;
    }
    return new Promise<unknown[]>((resolve) => {
      this.#waitingPoll = resolve;
      setTimeout(() => {
        if (this.#waitingPoll === resolve) {
          this.#waitingPoll = null;
          resolve([]);
        }
      }, 1_000);
    });
  }
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

function respond(response: import("node:http").ServerResponse, result: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: true, result }));
}
