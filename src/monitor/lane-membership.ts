/**
 * A lane's membership as the running gateway holds it: what the generated file says, and the moves
 * that change it.
 *
 * **A write is an actuator only when it is paired with a lander** (ADR-0021), and the two are
 * separate calls here for one reason: the land must not happen inside the turn that asked for it.
 * A stand down is asked for in the chat, so the write goes out immediately and the land waits for
 * the reply to leave — measured in `docs/research/landing-an-agents-write.md`, where a channel
 * reloaded mid-turn left the gateway alive with nothing listening.
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
  /** Landings are queued, never overlapped: two channel reloads at once is one channel stopped
   * while the other is starting it, and the file they both land is the same file anyway. */
  #landing: Promise<unknown> = Promise.resolve();

  constructor(deployment: Deployment) {
    this.#deployment = deployment;
  }

  /**
   * Whether the file holds the lanes the ledgers imply — what is standing down and what has been
   * taken out for good, which compose a chain the same way and differ only in what puts a rung
   * back. Only the two chains are compared: unrelated drift in a machine's own file is not this
   * unit's to correct, and a machine with no file at all is not either — the generator runs before the gateway (ADR-0019), and a monitor
   * that wrote the first configuration would be standing in for an install. A file that is there
   * and will not parse is a file to write again, since nothing can be said about what it holds.
   */
  differsFrom(absent: readonly string[]): boolean {
    if (!existsSync(this.#deployment.configPath)) return false;
    const written = this.#read();
    if (written === null) return true;
    const held = chainsIn(written);
    return (
      JSON.stringify(held.front) !== JSON.stringify(laneChain(frontLane, absent)) ||
      JSON.stringify(held.worker) !== JSON.stringify(laneChain(workerLane, absent))
    );
  }

  /**
   * The write, which is applied and not landed: the next turn still uses the chain the gateway last
   * built from. Both ledgers are read by the generator itself.
   */
  write(): void {
    generateConfig(this.#deployment, readCarrierMap(this.#deployment.carrierMap));
  }

  /** The lander, which is the half that reaches a turn. One at a time, in the order asked. */
  land(): Promise<Landed> {
    const landed = this.#landing.then(() => landConfigWrite(this.#deployment));
    this.#landing = landed.catch(() => undefined);
    return landed;
  }

  #read(): unknown {
    try {
      return JSON.parse(readFileSync(this.#deployment.configPath, "utf8")) as unknown;
    } catch {
      return null;
    }
  }
}
