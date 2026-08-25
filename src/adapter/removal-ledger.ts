/**
 * The ledger of which rungs the Owner has taken out of a lane for good, and the reading of it a
 * generated configuration is composed against (ADR-0012).
 *
 * It is a second ledger rather than a stand down with no reset, and the difference is the whole
 * point of both: a stand down is bounded by a reset and is written back at it, where a removal has
 * no reset to return at. `CONTEXT.md` calls the missing half *a rung retired by accident*, and the
 * answer is that a removal is never automatic — nothing writes here except the Owner's own tap.
 *
 * It is read here and written by the lane monitor, on the same argument as the stand-down ledger:
 * the generated file is an output of the ledgers, so a redeploy from the authored contract cannot
 * put a removed rung back.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** One rung out of its lane for good, and what it was said to be doing when it went. */
export type Removed = {
  /** The rung, as `provider/model`: the name it carries in the chain it is missing from. */
  rung: string;
  lane: string;
  at: string;
  /** The provider's own words, carried over from the report the removal was tapped on. */
  said: string;
};

export function removalLedger(monitorState: string): string {
  return join(monitorState, "removed-rungs.json");
}

/** What a lane's chain is composed without, read from the ledger and never from the config file. */
export function removedRungs(monitorState: string): Removed[] {
  return readRemovals(removalLedger(monitorState));
}

/**
 * A ledger that will not parse is read as *nothing has been removed*, which errs the way the
 * stand-down ledger does: a rung wrongly back in its lane costs the round-trip its provider is
 * already refusing, where a rung wrongly out of it is a lane short a member the Owner never took.
 */
export function readRemovals(path: string): Removed[] {
  if (!existsSync(path)) return [];
  try {
    const held = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(held) ? held.filter(isRemoval) : [];
  } catch {
    return [];
  }
}

function isRemoval(held: unknown): held is Removed {
  if (typeof held !== "object" || held === null) return false;
  const one = held as Removed;
  return (
    typeof one.rung === "string" &&
    typeof one.lane === "string" &&
    typeof one.at === "string" &&
    typeof one.said === "string"
  );
}
