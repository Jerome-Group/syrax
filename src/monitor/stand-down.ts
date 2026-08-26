/**
 * The register: the stand-down ledger plus the two moves that change it (ADR-0009).
 *
 * Nothing here writes the configuration. What a stand down actuates is `lane-membership.ts`,
 * because a write has to be paired with a lander to mean anything (ADR-0021) and this is the state
 * rather than the actuator.
 *
 * A stand down has no expiry of its own either. It is bounded by a stated reset, and the return is
 * *owned* — scheduled by whoever stood the rung down, and re-derived here on the way in for the
 * case where nothing was running when the reset came.
 *
 * **Both kinds are bounded the same way and mean different things by it** (ADR-0035). An allowance
 * stand down comes back because its reset arrived; a size one comes back to be tried again, because
 * nothing here can see a session shrink and putting the rung back is the only way to find out. The
 * guards below do not distinguish them, deliberately: a lane emptied by the monitor answers exactly
 * as little as one emptied by the Owner.
 */

import { modelRef } from "../adapter/lane.ts";
import { laneHolding } from "../adapter/lanes.ts";
import { writePrivateFile } from "../adapter/private-state.ts";
import {
  readLedger,
  standDownLedger,
  type StandDown,
  type StandDownKind,
} from "../adapter/stand-down-ledger.ts";

export class AlreadyReturned extends Error {}

/** The last-rung guard, typed so a caller standing a rung down unattended can tell it from a
 * failure to write. It is the one refusal below that an automatic stand down expects to meet. */
export class WouldEmptyLane extends Error {}

export class StandDowns {
  #path: string;
  #held: StandDown[];
  #returnedWhileDown: StandDown[];

  /** Re-derived on the way in: a reset that passed while nothing was running has still passed. */
  constructor(monitorState: string, now: Date = new Date()) {
    this.#path = standDownLedger(monitorState);
    const held = readLedger(this.#path);
    this.#held = held.filter((one) => Date.parse(one.until) > +now);
    this.#returnedWhileDown = held.filter((one) => Date.parse(one.until) <= +now);
    if (this.#returnedWhileDown.length > 0) this.#write();
  }

  /**
   * The rungs whose reset arrived while this unit was not running. They are returns like any
   * other and are kept for the announcement they are owed: the same event happening in process
   * says so, and one happening across a restart saying nothing would be the same event twice with
   * two behaviours.
   */
  returnedWhileDown(): StandDown[] {
    return [...this.#returnedWhileDown];
  }

  active(now: Date = new Date()): StandDown[] {
    return this.#held.filter((held) => Date.parse(held.until) > +now);
  }

  /**
   * Refuses rather than writes wherever the stand down would not be one: a rung no lane holds, a
   * reset already behind us, and — the one that matters — the last rung of a lane, which is a lane
   * that answers nothing rather than a lane that is short of one. The rungs the Owner has removed
   * for good count against that last one: they are missing from the same chain, and a lane emptied
   * between the two ledgers is one the generator would refuse to compose after this had been
   * written (ADR-0012).
   */
  stand(
    asked: { rung: string; until: Date; why: string; kind?: StandDownKind },
    now: Date = new Date(),
    removed: readonly string[] = [],
  ): StandDown {
    const lane = laneHolding(asked.rung);
    if (lane === undefined) {
      throw new Error(
        `${asked.rung} is no rung of either lane, so there is nothing to stand down.`,
      );
    }
    if (+asked.until <= +now) {
      throw new Error(
        `${asked.until.toISOString()} is not a reset to stand ${asked.rung} down until: it has passed.`,
      );
    }
    if (this.active(now).some((held) => held.rung === asked.rung)) {
      throw new Error(`${asked.rung} is already standing down.`);
    }
    const out = new Set([...this.active(now).map((held) => held.rung), ...removed, asked.rung]);
    if (lane.rungs.every((rung) => out.has(modelRef(rung)))) {
      throw new WouldEmptyLane(
        `${asked.rung} is the ${lane.name} lane's last rung, and a lane with none answers nothing.`,
      );
    }

    const standDown: StandDown = {
      rung: asked.rung,
      lane: lane.name,
      at: now.toISOString(),
      until: asked.until.toISOString(),
      why: asked.why,
      kind: asked.kind ?? "allowance",
    };
    this.#held = [...this.active(now), standDown];
    this.#write();
    return standDown;
  }

  /**
   * The other half, and the half a stand down is not one without: the rung goes back in its lane.
   * It is looked up in the ledger rather than among the active ones, because the ordinary caller is
   * the return arriving *at* the reset — by which time the entry has stopped being active, and
   * refusing it there would leave the rung out of its lane with nothing left to put it back.
   */
  bringBack(rung: string): StandDown {
    const held = this.#held.find((one) => one.rung === rung);
    if (held === undefined) throw new AlreadyReturned(`${rung} is not standing down.`);
    this.#held = this.#held.filter((one) => one.rung !== rung);
    this.#write();
    return held;
  }

  #write(): void {
    writePrivateFile(this.#path, `${JSON.stringify(this.#held, null, 2)}\n`);
  }
}
