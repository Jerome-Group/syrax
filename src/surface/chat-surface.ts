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
import { chat, chats, systemChatId, type Chat, type ChatId } from "../adapter/chats.ts";
import type { Deployment } from "../adapter/deployment.ts";
import { generateConfig } from "../adapter/generator.ts";
import { readSecret, secretPaths } from "../adapter/secrets-store.ts";
import { BotApi, isMissingCarrier } from "./bot-api.ts";

export type Recreation = { chat: Chat; carrier: number };

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
   * Posts into a chat, recreating its carrier if the send finds it gone, and announcing every
   * genuine recreation in System with its new id. A chat is recreated at most once per post, so an
   * announcement that recreates System in turn is itself announced and nothing recurses further.
   */
  async post(id: ChatId, text: string): Promise<Recreation[]> {
    const recreations = await this.#deliver(chat(id), text);
    const announced: Recreation[] = [];
    while (announced.length < recreations.length) {
      const next = recreations[announced.length]!;
      announced.push(next);
      recreations.push(...(await this.#deliver(chat(systemChatId), announcement(next))));
    }
    return recreations;
  }

  /**
   * Creates a carrier for every chat the map does not name, which is what the wizard does on a
   * fresh machine. Nothing is posted and nothing is announced: the Owner is present, and an
   * announcement is for a recreation they did not ask for.
   */
  async provision(): Promise<Recreation[]> {
    const missing = chats.filter((subject) => this.#carriers[subject.id] === undefined);
    const provisioned: Recreation[] = [];
    for (const subject of missing) {
      provisioned.push({ chat: subject, carrier: await this.#recreate(subject) });
    }
    return provisioned;
  }

  async #deliver(subject: Chat, text: string): Promise<Recreation[]> {
    const carrier = this.#carriers[subject.id];
    if (carrier !== undefined) {
      try {
        await this.#api.sendMessage(this.#deployment.ownerTelegramUserId, text, carrier);
        return [];
      } catch (error) {
        if (!isMissingCarrier(error)) throw error;
      }
    }

    const recreated = await this.#recreate(subject);
    await this.#api.sendMessage(this.#deployment.ownerTelegramUserId, text, recreated);
    return [{ chat: subject, carrier: recreated }];
  }

  /**
   * The map is rewritten and the configuration regenerated before the retry, because a carrier the
   * runtime does not know about routes to the default agent — General answering a chat it does not
   * own is the failure this closes.
   */
  async #recreate(subject: Chat): Promise<number> {
    const carrier = await this.#api.createForumTopic(
      this.#deployment.ownerTelegramUserId,
      subject.carrierName,
    );
    this.#carriers = { ...this.#carriers, [subject.id]: carrier };
    writeCarrierMap(this.#deployment.carrierMap, this.#carriers);
    generateConfig(this.#deployment, this.#carriers);
    return carrier;
  }
}

/**
 * The line names the consequence rather than the event. Media's is the one worth naming: Seerr
 * holds the old carrier in its own configuration and posts there on Syrax's bot token, so a
 * recreated Media chat leaves it writing into a dead thread — and its `400` is invisible here.
 */
function announcement(recreated: Recreation): string {
  const opening = `${recreated.chat.carrierName} came back empty on carrier ${recreated.carrier}. Everything that was in it is gone.`;
  return recreated.chat.id === "media"
    ? `${opening} Seerr still posts availability into the old carrier: re-point it at ${recreated.carrier}, which is a stage of the provisioning wizard.`
    : opening;
}
