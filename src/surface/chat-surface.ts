/**
 * Syrax's own writes into its four chats, and the one place a cleared carrier is discovered.
 *
 * Verification lives here rather than at startup because sending is the only discovery path there
 * is (ADR-0013): the platform has no read that does not itself resurrect what it was asked about,
 * so a startup pass would buy nothing over the send that is happening anyway. A recreation is
 * announced and a resurrection is not, for the same reason — Syrax can see the first and cannot
 * see the second.
 */

import { readCarrierMap, writeCarrierMap, type CarrierMap } from "../adapter/carriers.ts";
import { chats, everyChat, systemChat, type Chat, type ChatId } from "../adapter/chats.ts";
import type { Deployment } from "../adapter/deployment.ts";
import { generateConfig } from "../adapter/generator.ts";
import { readSecret, secretPaths } from "../adapter/secrets-store.ts";
import { BotApi, isMissingCarrier } from "./bot-api.ts";

/** One chat and the topic now carrying it, as this run either created it or found it missing. */
export type Carrier = { chat: Chat; id: number };

export class ChatSurface {
  readonly #deployment: Deployment;
  readonly #api: BotApi;
  #carriers: CarrierMap;

  constructor(deployment: Deployment, api: BotApi, carriers: CarrierMap) {
    this.#deployment = deployment;
    this.#api = api;
    this.#carriers = carriers;
  }

  static open(deployment: Deployment): ChatSurface {
    const token = readSecret(deployment.secretsStore, secretPaths.telegramBotToken);
    return new ChatSurface(
      deployment,
      new BotApi(deployment.telegramApiRoot, token),
      readCarrierMap(deployment.carrierMap),
    );
  }

  /**
   * Creates a carrier for every chat the map does not name, which is what the wizard does on a
   * fresh machine. Nothing is posted and nothing is announced: the Owner is present, and an
   * announcement is for a recreation they did not ask for.
   */
  async provision(): Promise<Carrier[]> {
    const missing = everyChat.filter((chat) => this.#carriers[chat.id] === undefined);
    const provisioned: Carrier[] = [];
    for (const chat of missing) provisioned.push(await this.#recreate(chat));
    return provisioned;
  }

  /**
   * Posts into a chat, recreating its carrier if the send finds it gone, and announcing every
   * recreation in System with its new id. Announcing can itself recreate System, so announcements
   * are drained from a queue rather than sent in one pass — and the queue empties, because a chat
   * that has just been recreated is there to be written into.
   */
  async post(id: ChatId, text: string): Promise<Carrier[]> {
    const recreated = await this.#deliver(chats[id], text);
    const announced: Carrier[] = [];
    for (const carrier of recreated) {
      announced.push(carrier);
      recreated.push(...(await this.#deliver(systemChat, announcement(carrier))));
    }
    return announced;
  }

  async #deliver(chat: Chat, text: string): Promise<Carrier[]> {
    const carrier = this.#carriers[chat.id];
    if (carrier !== undefined) {
      try {
        await this.#api.sendMessage(this.#deployment.ownerTelegramUserId, text, carrier);
        return [];
      } catch (error) {
        if (!isMissingCarrier(error)) throw error;
      }
    }

    const recreated = await this.#recreate(chat);
    await this.#api.sendMessage(this.#deployment.ownerTelegramUserId, text, recreated.id);
    return [recreated];
  }

  /**
   * The map and the configuration are rewritten before the retry, and the running gateway picks the
   * new carrier up by itself — a `channels` write is landed by a channel reload, which is deferred
   * only until the turns in flight drain (ADR-0021). So the first message the Owner types in the
   * recreated chat can still meet the old routing and be answered as General, which is ADR-0013's
   * standing rule for an unrecognised thread id, and the one after it lands on the right agent.
   */
  async #recreate(chat: Chat): Promise<Carrier> {
    const id = await this.#api.createForumTopic(
      this.#deployment.ownerTelegramUserId,
      chat.carrierName,
    );
    this.#carriers = { ...this.#carriers, [chat.id]: id };
    writeCarrierMap(this.#deployment.carrierMap, this.#carriers);
    generateConfig(this.#deployment, this.#carriers);
    return { chat, id };
  }
}

/**
 * The line names the consequences rather than the event. Two of them always apply — the chat is
 * empty, and the first message typed there may still meet the old routing — and the chat may carry
 * a third that only it knows about.
 */
function announcement(recreated: Carrier): string {
  return [
    `${recreated.chat.carrierName} came back empty on carrier ${recreated.id}. Everything that was in it is gone.`,
    "The first message you type there may be answered as General; the next one lands.",
    recreated.chat.recreationNote?.(recreated.id),
  ]
    .filter((line) => line !== undefined)
    .join(" ");
}
