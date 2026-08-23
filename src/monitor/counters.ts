/**
 * The rationed lane's counters: one per rung, spent by the hatch and kept on disk so that a restart
 * of the unit does not hand back an allowance that has already gone (ADR-0006).
 *
 * **The day rolls in Pacific time, which is where Google resets a free-tier quota.** That reset is
 * published rather than measured here, and the error each way is not symmetrical: rolling early
 * hands back requests the provider has not, and the hatch's whole job is to refuse before it
 * spends. So the zone is the conservative reading of an unverified fact rather than a detail.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writePrivateFile } from "../adapter/private-state.ts";
import { hatchLane, type RationedRung, rungId } from "../adapter/hatch-lane.ts";

const resetZone = "America/Los_Angeles";

export function providerDay(at: Date): string {
  return at.toLocaleDateString("en-CA", { timeZone: resetZone });
}

/** What refused a rung last, in the provider's own words rather than in a taxonomy of ours. */
export type Refusal = { at: string; status: number | null; said: string };

export type Spent = {
  rung: string;
  spent: number;
  allowance: number;
  remaining: number;
  refused?: Refusal;
};

/**
 * The ledger on disk: the day the counts belong to, what has gone in it, and what refused each rung
 * last. The refusals are **not** day-scoped — a provider that went bad at 23:50 is the thing a
 * reader wants at 00:10, and a count is what the reset empties.
 */
type Ledger = { day: string; spent: Record<string, number>; refused: Record<string, Refusal> };

export class DailyCounters {
  #path: string;
  #ledger: Ledger;

  constructor(monitorState: string, now: Date = new Date()) {
    this.#path = join(monitorState, "hatch-counters.json");
    this.#ledger = this.#read(now);
  }

  remaining(rung: RationedRung, now: Date = new Date()): number {
    this.#rollTheDay(now);
    return Math.max(0, rung.dailyRequests - (this.#ledger.spent[rungId(rung)] ?? 0));
  }

  /**
   * Counted before the request leaves rather than after it answers: a refusal spends the allowance
   * too, so a counter that waits for a reply is a counter that undercounts exactly when it matters.
   */
  spend(rung: RationedRung, now: Date = new Date()): void {
    this.#rollTheDay(now);
    const id = rungId(rung);
    this.#ledger.spent[id] = (this.#ledger.spent[id] ?? 0) + 1;
    this.#write();
  }

  /**
   * Put back a call the provider never served. It is the other half of spending first: the count
   * has to be there while the request is in flight, and a request an overloaded backend refused was
   * never charged for — so a bad ten minutes must not be able to eat a rung's whole day.
   */
  refund(rung: RationedRung, now: Date = new Date()): void {
    this.#rollTheDay(now);
    const id = rungId(rung);
    this.#ledger.spent[id] = Math.max(0, (this.#ledger.spent[id] ?? 0) - 1);
    this.#write();
  }

  /** What refused a rung, kept where the counts are so it outlives the chat it was said in. */
  refuse(rung: RationedRung, refusal: Refusal, now: Date = new Date()): void {
    this.#rollTheDay(now);
    this.#ledger.refused[rungId(rung)] = refusal;
    this.#write();
  }

  /** Every rung of the lane, spent or not, so a report never has to guess at an absent key. */
  state(now: Date = new Date()): Spent[] {
    this.#rollTheDay(now);
    return hatchLane.rungs.map((rung) => {
      const refused = this.#ledger.refused[rungId(rung)];
      return {
        rung: rungId(rung),
        spent: this.#ledger.spent[rungId(rung)] ?? 0,
        allowance: rung.dailyRequests,
        remaining: this.remaining(rung, now),
        ...(refused === undefined ? {} : { refused }),
      };
    });
  }

  #rollTheDay(now: Date): void {
    const today = providerDay(now);
    if (this.#ledger.day === today) return;
    this.#ledger = { day: today, spent: {}, refused: this.#ledger.refused };
  }

  #write(): void {
    writePrivateFile(this.#path, `${JSON.stringify(this.#ledger, null, 2)}\n`);
  }

  /**
   * A ledger that will not parse is read as *nothing has been spent today*, which is the one place
   * this file is deliberately optimistic: the alternative is a hatch that refuses forever because a
   * counter file went bad, and the provider's own 429 is still underneath it.
   */
  #read(now: Date): Ledger {
    const fresh = { day: providerDay(now), spent: {}, refused: {} };
    if (!existsSync(this.#path)) return fresh;
    try {
      const held = JSON.parse(readFileSync(this.#path, "utf8")) as Partial<Ledger>;
      if (typeof held.day !== "string" || typeof held.spent !== "object" || held.spent === null) {
        return fresh;
      }
      const spent = Object.fromEntries(
        Object.entries(held.spent).filter(([, count]) => Number.isSafeInteger(count)),
      );
      return { day: held.day, spent, refused: readRefusals(held.refused) };
    } catch {
      return fresh;
    }
  }
}

/** A refusal is read back only where every field survived: half a record is worse than none. */
function readRefusals(held: unknown): Record<string, Refusal> {
  if (typeof held !== "object" || held === null) return {};
  const kept = Object.entries(held).filter(
    ([, refusal]) =>
      typeof refusal === "object" &&
      refusal !== null &&
      typeof (refusal as Refusal).at === "string" &&
      typeof (refusal as Refusal).said === "string",
  );
  return Object.fromEntries(kept) as Record<string, Refusal>;
}
