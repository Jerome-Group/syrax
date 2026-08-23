/**
 * The Telegram wire, standing in for the Bot API. The gateway long-polls it exactly as it polls
 * Telegram, so a test drives routing and lockdown by injecting an update and reading what crossed
 * the wire — never by reaching inside the runtime.
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** What crossed the wire, and — where the call posted one — the id the message came back with. */
export type OutboundCall = {
  method: string;
  body: Record<string, unknown>;
  messageId?: number;
};

/** A tap on one of the bot's own inline buttons, carrying the topic the message sits in. */
export type InjectedTap = {
  fromUserId: number;
  data: string;
  messageId: number;
  chatId?: number;
  messageThreadId?: number;
};

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
  #waitingPolls = new Set<(updates: unknown[]) => void>();
  #nextUpdateId = 1;
  #nextMessageId = 1000;
  #nextTopicId = 2;
  #topics = new Set<number>();

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

  /**
   * A topic the wizard created. Thread ids start at 2 because a private threaded chat has no
   * thread 1 at all: the non-deletable General topic belongs to forum supergroups.
   */
  createTopic(): number {
    const carrier = this.#nextTopicId++;
    this.#topics.add(carrier);
    return carrier;
  }

  /** The Owner clearing a topic in their client. Nothing is emitted; the next write discovers it. */
  clearTopic(carrier: number): void {
    this.#topics.delete(carrier);
  }

  /**
   * The Owner tapping a button. The message the tap belongs to is named rather than looked up: the
   * stub records what crossed the wire and does not keep a chat, and the id is in that record.
   */
  injectTap(tap: InjectedTap): void {
    const chatId = tap.chatId ?? tap.fromUserId;
    this.#deliver({
      update_id: this.#nextUpdateId++,
      callback_query: {
        id: `tap-${this.#nextUpdateId}`,
        from: { id: tap.fromUserId, is_bot: false, first_name: "Sender" },
        chat_instance: "stub-instance",
        data: tap.data,
        message: {
          message_id: tap.messageId,
          date: 1755000000,
          chat: { id: chatId, type: "private", first_name: "Owner" },
          from: botIdentity,
          text: "the message the buttons hang on",
          ...(tap.messageThreadId === undefined
            ? {}
            : { message_thread_id: tap.messageThreadId, is_topic_message: true }),
        },
      },
    });
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

  /**
   * Resolves once a call matching `method` has crossed the wire, or rejects at the deadline.
   * `since` is how many matching calls to skip, so a second turn waits for its own answer rather
   * than finding the first one again.
   */
  async waitFor(
    method: string,
    predicate: (call: OutboundCall) => boolean = () => true,
    timeoutMs = 120_000,
    since = 0,
  ): Promise<OutboundCall> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.matching(method, predicate)[since];
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`No ${method} within ${timeoutMs}ms.`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  matching(
    method: string,
    predicate: (call: OutboundCall) => boolean = () => true,
  ): OutboundCall[] {
    return this.calls.filter((call) => call.method === method && predicate(call));
  }

  /**
   * Resolves once nothing has crossed the wire for `quietMs`, so a test that reads the *order* of
   * calls starts from a wire the last turn has finished with. A turn's own trailing calls — the
   * progress draft's edit and deletion — land after the answer a test waited for.
   */
  async quiet(quietMs = 1_500): Promise<void> {
    for (;;) {
      const seen = this.calls.length;
      await new Promise((resolve) => setTimeout(resolve, quietMs));
      if (this.calls.length === seen) return;
    }
  }

  /** Nothing new crossed the wire: still `since` calls of `method` after settling for `quietMs`. */
  async stayedSilent(method: string, quietMs = 8_000, since = 0): Promise<boolean> {
    await new Promise((resolve) => setTimeout(resolve, quietMs));
    return this.calls.filter((call) => call.method === method).length === since;
  }

  async close(): Promise<void> {
    this.#releaseWaitingPolls();
    await new Promise<void>((resolve, reject) =>
      this.#server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  #deliver(update: unknown): void {
    // Exactly one poll takes the update; the rest keep waiting, so no request is ever orphaned.
    const [waiting] = this.#waitingPolls;
    if (waiting) {
      this.#waitingPolls.delete(waiting);
      waiting([update]);
      return;
    }
    this.#pending.push(update);
  }

  #releaseWaitingPolls(): void {
    for (const waiting of this.#waitingPolls) waiting([]);
    this.#waitingPolls.clear();
  }

  async #handle(request: IncomingMessage, response: import("node:http").ServerResponse) {
    // The path alone: Telegram's own long-polling form carries a query string, and a method read
    // off the raw URL would neither route nor be recorded under its own name.
    const method = new URL(request.url ?? "/", "http://stub").pathname.split("/").pop() ?? "";
    const body = await readBody(request);

    if (method === "getUpdates") {
      const updates = await this.#collectUpdates();
      return respond(response, updates);
    }

    const call: OutboundCall = { method, body };
    this.calls.push(call);

    if (method === "getMe") return respond(response, botIdentity);
    if (method === "createForumTopic") {
      return respond(response, { message_thread_id: this.createTopic(), name: body.name });
    }
    if (method === "sendDocument" || method === "sendPhoto") {
      call.messageId = this.#nextMessageId++;
      return respond(response, {
        message_id: call.messageId,
        date: 1755000000,
        chat: { id: body.chat_id, type: "private" },
        from: botIdentity,
      });
    }
    if (method === "sendMessage" || method === "editMessageText") {
      const carrier = body.message_thread_id;
      if (typeof carrier === "number" && !this.#topics.has(carrier)) {
        return refuse(response, "Bad Request: message thread not found");
      }
      if (body.text === "") return refuse(response, "Bad Request: message text is empty");
      call.messageId = this.#nextMessageId++;
      return respond(response, {
        message_id: call.messageId,
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
      this.#waitingPolls.add(resolve);
      setTimeout(() => {
        if (this.#waitingPolls.delete(resolve)) resolve([]);
      }, 1_000);
    });
  }
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  if (request.headers["content-type"]?.startsWith("multipart/form-data")) return formFields(raw);
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * A file upload is the one call Telegram takes as multipart rather than JSON. Its fields are read
 * out by name, and the attachment each one references is recorded as the **filename** the bot put
 * on the wire — which is what a test asking *which document was sent* wants, and never the bytes.
 */
function formFields(raw: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const filenames: Record<string, string> = {};
  for (const part of raw.split(/--[^\r\n]+\r\n/).slice(1)) {
    const name = /name="([^"]+)"/.exec(part)?.[1];
    if (name === undefined) continue;
    const filename = /filename="?([^";\r\n]+)"?/.exec(part)?.[1];
    if (filename !== undefined) {
      filenames[name] = filename;
      continue;
    }
    const value = part.split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n$/, "");
    fields[name] = /^-?\d+$/.test(value) ? Number(value) : value;
  }
  for (const [name, value] of Object.entries(fields)) {
    const attached =
      typeof value === "string" ? filenames[value.replace("attach://", "")] : undefined;
    if (attached !== undefined) fields[name] = attached;
  }
  return fields;
}

/** Telegram answers a bad request with 400 and its own description, which is the only probe. */
function refuse(response: import("node:http").ServerResponse, description: string): void {
  response.writeHead(400, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: false, error_code: 400, description }));
}

function respond(response: import("node:http").ServerResponse, result: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: true, result }));
}
