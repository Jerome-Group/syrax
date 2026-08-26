/**
 * The ledger of which rungs are standing down: the file, and the reading of it a generated
 * configuration is composed against (ADR-0009).
 *
 * **It is read here and written by the lane monitor.** The generated file says which rungs a lane
 * holds, and it is written from the lanes as this repository composes them — so a redeploy that
 * read the live file back would revert a stand down made an hour ago, and one that trusted it would
 * restore a stand down whose reset has passed. Both are the same bug, and the answer is that this
 * ledger is the only thing anything asks: the configuration is an output of it.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Why a rung is out of its lane, and the two are not the same thing coming back (ADR-0035).
 *
 * An **allowance** stand down is the Owner's: a provider has nothing left, and `until` is the reset
 * they stated. A **size** stand down is the monitor's: the session has grown past what this rung's
 * ceiling will take, no amount of waiting changes that, and `until` is not a reset at all — it is
 * how long before the rung is put back to find out whether the session has shrunk.
 */
export type StandDownKind = "allowance" | "size";

/** One rung out of its lane, in the words of whoever put it there. */
export type StandDown = {
  /** The rung, as `provider/model`: the name it carries in the chain it is missing from. */
  rung: string;
  lane: string;
  at: string;
  /** When it goes back: a stated reset where the kind is an allowance, a re-test where it is size. */
  until: string;
  why: string;
  kind: StandDownKind;
};

export function standDownLedger(monitorState: string): string {
  return join(monitorState, "stand-downs.json");
}

/** What a lane's chain is composed without, read from the ledger and never from the config file. */
export function standingDown(monitorState: string, now: Date = new Date()): StandDown[] {
  return readLedger(standDownLedger(monitorState)).filter((held) => Date.parse(held.until) > +now);
}

/**
 * A ledger that will not parse is read as *nothing is standing down*, which errs the way the
 * counters do: a rung wrongly back in its lane costs the refusals its provider is already making,
 * where a rung wrongly out of it is a lane short a member with nothing to put it back.
 */
export function readLedger(path: string): StandDown[] {
  if (!existsSync(path)) return [];
  try {
    const held = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(held) ? held.filter(isStandDown).map(withKind) : [];
  } catch {
    return [];
  }
}

/**
 * A ledger written before stand downs had kinds holds allowance ones, which is what every entry
 * anybody has written by hand is. Defaulting rather than refusing keeps a live deployment's rungs
 * where they are across the upgrade that adds the field.
 */
function withKind(held: StandDown): StandDown {
  return held.kind === "size" ? held : { ...held, kind: "allowance" };
}

function isStandDown(held: unknown): held is StandDown {
  if (typeof held !== "object" || held === null) return false;
  const one = held as StandDown;
  return (
    typeof one.rung === "string" &&
    typeof one.lane === "string" &&
    typeof one.at === "string" &&
    typeof one.why === "string" &&
    typeof one.until === "string" &&
    Number.isFinite(Date.parse(one.until))
  );
}
