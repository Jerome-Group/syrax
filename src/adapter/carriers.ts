/**
 * The provisioning map: which topic currently carries each chat. It is private runtime state — the
 * ids are the Owner's own chat — and it is keyed by chat name rather than by position, so a
 * recreation rewrites one entry and matches nothing by the topic's own name (ADR-0013).
 *
 * Its loss is recovered by the write path and never by reading the surface back, because the
 * platform offers no read that does not itself resurrect what it was asked about.
 */

import { readFileSync } from "node:fs";
import { writePrivateFile } from "./private-state.ts";
import type { ChatId } from "./chats.ts";
import { everyChat } from "./chats.ts";

/** A chat with no entry has no carrier Syrax knows of, which the next write to it settles. */
export type CarrierMap = Partial<Record<ChatId, number>>;

export function readCarrierMap(path: string): CarrierMap {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  return carrierMap(JSON.parse(contents));
}

export function writeCarrierMap(path: string, map: CarrierMap): void {
  writePrivateFile(path, `${JSON.stringify(map, null, 2)}\n`);
}

/**
 * A carrier id that is not a topic id routes nothing and is silently never matched, so a map the
 * wizard half-wrote is refused here rather than at the first message that fails to arrive.
 */
export class InvalidCarrierMap extends Error {}

function carrierMap(source: unknown): CarrierMap {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    throw new InvalidCarrierMap("A carrier map is a JSON object keyed by chat.");
  }
  const known = new Set<string>(everyChat.map((chat) => chat.id));
  const entries = Object.entries(source).map(([id, carrier]) => {
    if (!known.has(id)) {
      throw new InvalidCarrierMap(`${id} is not one of Syrax's chats: ${[...known].join(", ")}.`);
    }
    if (!Number.isSafeInteger(carrier) || (carrier as number) <= 0) {
      throw new InvalidCarrierMap(`${id} names ${String(carrier)}, which is not a topic id.`);
    }
    return [id, carrier as number] as const;
  });
  return Object.fromEntries(entries);
}
