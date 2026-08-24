/**
 * A lane's membership as the running gateway holds it: what the generated file says, and the two
 * moves that change it.
 *
 * **A write is an actuator only when it is paired with a lander** (ADR-0021). A `channels` write
 * lands itself; a chain lives under `agents`, which is applied when written and landed only when
 * something rebuilds the turn path — so writing here is always writing *and* the runtime's own safe
 * restart. This is the one place that pairing exists, so a caller cannot do half of it.
 */

import { readCarrierMap } from "../adapter/carriers.ts";
import { chainsIn } from "../adapter/agent-defaults.ts";
import type { Deployment } from "../adapter/deployment.ts";
import { frontLane } from "../adapter/front-lane.ts";
import { generateConfig } from "../adapter/generator.ts";
import { laneChain } from "../adapter/lane.ts";
import { landConfigWrite, type Landed } from "../adapter/runtime-command.ts";
import { workerLane } from "../adapter/worker-lane.ts";
import { existsSync, readFileSync } from "node:fs";

export class LaneMembership {
  #deployment: Deployment;

  constructor(deployment: Deployment) {
    this.#deployment = deployment;
  }

  /**
   * Whether the file holds the lanes the ledger implies. Only the two chains are compared:
   * unrelated drift in a machine's own file is not this unit's to correct, and a machine with no
   * file at all is not either — the generator runs before the gateway (ADR-0019), and a monitor
   * that wrote the first configuration would be standing in for an install. A file that is there
   * and will not parse is a file to write again, since nothing can be said about what it holds.
   */
  differsFrom(standingDown: readonly string[]): boolean {
    if (!existsSync(this.#deployment.configPath)) return false;
    const written = this.#read();
    if (written === null) return true;
    const held = chainsIn(written);
    return (
      JSON.stringify(held.front) !== JSON.stringify(laneChain(frontLane, standingDown)) ||
      JSON.stringify(held.worker) !== JSON.stringify(laneChain(workerLane, standingDown))
    );
  }

  /** The write and its lander. The stand downs are read from the ledger by the generator itself. */
  write(): Promise<Landed> {
    generateConfig(this.#deployment, readCarrierMap(this.#deployment.carrierMap));
    return landConfigWrite(this.#deployment);
  }

  #read(): unknown {
    try {
      return JSON.parse(readFileSync(this.#deployment.configPath, "utf8")) as unknown;
    } catch {
      return null;
    }
  }
}
