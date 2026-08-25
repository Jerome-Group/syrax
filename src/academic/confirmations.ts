/**
 * The in-chat confirmation the two sanctioned writes stand behind, in the shape the removal tap
 * already has (ADR-0012, ADR-0026): the desk mints a value, the Owner taps the button carrying it,
 * and the write happens on that value and on nothing else.
 *
 * It is a minted value rather than a word the agent could type because that is the difference
 * between a confirmation and a formality: a model asked to obtain confirmation can decide it has
 * one, and cannot decide it holds sixty-four bytes only this process ever wrote down.
 *
 * They are held in memory, so a value minted by a process that has since died confirms nothing —
 * the Owner asks again and taps the button on the fresh message. Nothing has to decide when
 * forgetting one is safe, and an old tap can never reach a write.
 */

import { randomUUID } from "node:crypto";

/** The two writes, and there are no others: a sync that spends the session, and a Promotion. */
export type Write = { kind: "sync" } | { kind: "promotion"; proposalId: string };

export type Confirmation = { text: string; value: string };

/** How long a tap stays good for. Long enough to read the message; short enough to be this turn's. */
export const confirmationHoldsMs = 30 * 60_000;

export class Confirmations {
  #writes = new Map<string, { write: Write; mintedAt: number }>();

  /** A button for one write, minted fresh: two asks are two taps, never one reused. */
  offer(write: Write, now: Date = new Date()): Confirmation {
    const value = `confirm:${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    this.#writes.set(value, { write, mintedAt: +now });
    return { text: textFor(write), value };
  }

  /**
   * The write a tap names, and then never again: a value is spent when it resolves, so a second tap
   * on the same button cannot run the write twice. An expired or unknown value resolves to nothing,
   * which is the answer the agent relays rather than working around.
   */
  resolve(value: string, now: Date = new Date()): Write | undefined {
    const held = this.#writes.get(value);
    if (held === undefined) return undefined;
    this.#writes.delete(value);
    return +now - held.mintedAt > confirmationHoldsMs ? undefined : held.write;
  }
}

function textFor(write: Write): string {
  return write.kind === "sync"
    ? "Sync NTULearn now"
    : `Promote ${write.proposalId} to the calendar`;
}
