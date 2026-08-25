/**
 * The removal register: the ledger of rungs taken out of a lane for good, plus the one move that
 * changes it (ADR-0012). There is no second move — nothing here puts a rung back, because a removal
 * is the Owner deciding a name is gone rather than Syrax parking it until a reset.
 *
 * Nothing here writes the configuration either. What a removal actuates is `lane-membership.ts`,
 * for the reason a stand down does: a write means nothing without a lander (ADR-0021).
 */

import { modelRef } from "../adapter/lane.ts";
import { laneHolding } from "../adapter/lanes.ts";
import { writePrivateFile } from "../adapter/private-state.ts";
import { readRemovals, removalLedger, type Removed } from "../adapter/removal-ledger.ts";

export class Removals {
  #path: string;
  #held: Removed[];

  constructor(monitorState: string) {
    this.#path = removalLedger(monitorState);
    this.#held = readRemovals(this.#path);
  }

  removed(): Removed[] {
    return [...this.#held];
  }

  rungs(): string[] {
    return this.#held.map((one) => one.rung);
  }

  /** Whether the rung is already out for good, which is a tap that has nothing left to do. */
  holds(rung: string): boolean {
    return this.#held.some((one) => one.rung === rung);
  }

  /**
   * Refuses rather than writes wherever the removal would leave a lane that answers nothing. The
   * rungs standing down are counted against that too, and they have to be: they are missing from
   * the same chain, and a removal that emptied a lane between them would be refused by the
   * generator *after* this ledger had been written — a removal nothing could compose a chain from.
   */
  remove(
    rung: string,
    said: string,
    standingDown: readonly string[] = [],
    now: Date = new Date(),
  ): Removed {
    const lane = laneHolding(rung);
    if (lane === undefined) {
      throw new Error(`${rung} is no rung of either lane, so there is nothing to remove.`);
    }
    const already = this.#held.find((one) => one.rung === rung);
    if (already !== undefined) return already;
    const out = new Set([...this.rungs(), ...standingDown, rung]);
    if (lane.rungs.every((one) => out.has(modelRef(one)))) {
      throw new Error(
        `${rung} is the ${lane.name} lane's last rung, and a lane with none answers nothing.`,
      );
    }

    const removal: Removed = { rung, lane: lane.name, at: now.toISOString(), said };
    this.#held = [...this.#held, removal];
    writePrivateFile(this.#path, `${JSON.stringify(this.#held, null, 2)}\n`);
    return removal;
  }
}
