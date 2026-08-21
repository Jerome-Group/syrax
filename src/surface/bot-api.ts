/**
 * The two Bot API calls Syrax's own proactive writes need. It goes to the wire directly rather
 * than through the runtime because the failure is the point: a send into a cleared carrier is the
 * only probe the platform has (ADR-0013), and what makes it usable is Telegram's own description
 * arriving intact rather than flattened into some other layer's error.
 */

export class TelegramApiError extends Error {
  readonly errorCode: number;
  readonly description: string;

  constructor(method: string, errorCode: number, description: string) {
    super(`${method} failed: ${errorCode} ${description}`);
    this.errorCode = errorCode;
    this.description = description;
  }
}

/**
 * The carrier is gone and the chat is not. Every other failure is somebody else's to handle: this
 * one alone means the topic the map names no longer exists to be written into.
 */
export function isMissingCarrier(error: unknown): boolean {
  return (
    error instanceof TelegramApiError &&
    error.errorCode === 400 &&
    /message thread not found/i.test(error.description)
  );
}

export type Message = { messageId: number };

export class BotApi {
  readonly #apiRoot: string;
  readonly #token: string;

  constructor(apiRoot: string, token: string) {
    this.#apiRoot = apiRoot;
    this.#token = token;
  }

  async sendMessage(chatId: number, text: string, carrier?: number): Promise<Message> {
    const sent = await this.#call<{ message_id: number }>("sendMessage", {
      chat_id: chatId,
      text,
      ...(carrier === undefined ? {} : { message_thread_id: carrier }),
    });
    return { messageId: sent.message_id };
  }

  /** Returns the new carrier: the id of the service message that created the topic. */
  async createForumTopic(chatId: number, name: string): Promise<number> {
    const created = await this.#call<{ message_thread_id: number }>("createForumTopic", {
      chat_id: chatId,
      name,
    });
    return created.message_thread_id;
  }

  async #call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.#apiRoot}/bot${this.#token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as {
      ok: boolean;
      result?: T;
      error_code?: number;
      description?: string;
    };
    if (!payload.ok || payload.result === undefined) {
      throw new TelegramApiError(
        method,
        payload.error_code ?? response.status,
        payload.description ?? "no description",
      );
    }
    return payload.result;
  }
}
