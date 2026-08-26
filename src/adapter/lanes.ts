/**
 * The two lanes the runtime walks, in one list, and the name a rung of either is known by outside
 * its own file. `provider/model` is that name everywhere a rung is stood down, counted or reported,
 * so resolving one back to the lane holding it belongs here rather than in each caller.
 */

import { frontLane } from "./front-lane.ts";
import { type Lane, type Rung, modelRef } from "./lane.ts";
import { workerLane } from "./worker-lane.ts";

/** Both, in the order a reader meets them: the lane that talks, then the lane that thinks. */
export const chainLanes: readonly Lane[] = [frontLane, workerLane];

export function laneHolding(ref: string): Lane | undefined {
  return chainLanes.find((lane) => lane.rungs.some((rung) => modelRef(rung) === ref));
}

/** The rung itself, for the two questions that are the rung's rather than its lane's: what it
 * reserves, and what size of call its ceiling was written against (ADR-0035). */
export function rungNamed(ref: string): Rung | undefined {
  return chainLanes.flatMap((lane) => lane.rungs).find((rung) => modelRef(rung) === ref);
}

/** Every provider a lane reaches, once each: what a report states its headroom from. */
export function providersOf(lane: Lane) {
  return [...new Set(lane.rungs.map((rung) => rung.provider))];
}
