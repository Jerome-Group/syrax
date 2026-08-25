/**
 * The tap values a report's removal buttons carry, minted here and resolvable only here
 * (ADR-0012, and ADR-0026's shape for a shortlist).
 *
 * A value is minted rather than composed from the rung's own name for one reason: removal happens
 * **on the tap and only on the tap**, and a value a model could work out for itself is a removal a
 * model could ask for. The agent is told to pass a value back and never to decide what was tapped;
 * this is what makes that instruction enforceable rather than merely stated.
 *
 * They are held in memory, so a value minted by a process that has since died is unresolvable — the
 * Owner asks for the report again and taps the button on that one. That is the same trade the
 * search unit's shortlist makes: nothing has to decide when forgetting one is safe.
 */

import { randomUUID } from "node:crypto";
import type { Rotted } from "./rung-watch.ts";

/** One button: what it says, and the sixty-four bytes it carries back. */
export type Tap = { rung: string; text: string; value: string };

export class RemovalTaps {
  #rungOf = new Map<string, string>();
  #valueOf = new Map<string, string>();

  /**
   * A button per rotted rung. The value is reused where one was already minted for that rung, so a
   * button on a report from an hour ago still resolves — a report is posted on a transition and the
   * Owner reads it when they read it.
   */
  offer(rotted: readonly Rotted[]): Tap[] {
    return rotted.map((one) => ({
      rung: one.rung,
      text: `Remove ${one.rung}`,
      value: this.#valueFor(one.rung),
    }));
  }

  /** The rung a tap names, or nothing where this process never minted it. */
  resolve(value: string): string | undefined {
    return this.#rungOf.get(value);
  }

  #valueFor(rung: string): string {
    const held = this.#valueOf.get(rung);
    if (held !== undefined) return held;
    const value = `remove:${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    this.#valueOf.set(rung, value);
    this.#rungOf.set(value, rung);
    return value;
  }
}
