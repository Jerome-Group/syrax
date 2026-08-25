/**
 * What the fallback decisions mean for the lanes: which rung each lane is answering on, and which
 * rungs have stopped answering to their own names (ADR-0012).
 *
 * It is state rather than a feed. The log carries every decision in the window, and a report that
 * relayed them all would say the same thing every hour a rung stayed dead — so what is kept is the
 * lane's serving rung and the set of rotted ones, and what is announced is a **change** to either.
 *
 * **A rung is reported, never repaired.** Nothing here edits a chain: a 404 cannot be told apart
 * from a transient unrouting, and a removal with no reset to return at is a rung retired by
 * accident. The removal is the Owner's, and this is the thing that tells them there is one to make.
 */

import { modelRef } from "../adapter/lane.ts";
import { chainLanes, laneHolding } from "../adapter/lanes.ts";
import { writePrivateFile } from "../adapter/private-state.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Cursor, type Decision, readDecisions } from "./fallback-log.ts";
import type { Swept } from "./rung-sweep.ts";
import type { Transition } from "./usage-report.ts";

/** A rung that answered to no such name, and the words the provider refused it in. */
export type Rotted = { rung: string; lane: string; said: string; at: string };

export type Window = { from: string | null; to: string; unknown: string | null };

type Watched = {
  cursor: Cursor | null;
  /** The rung each lane was last seen answering on. */
  serving: Record<string, string>;
  rotted: Rotted[];
  window: Window | null;
};

export class RungWatch {
  #path: string;
  #logPath: string;
  #held: Watched;

  constructor(monitorState: string, logPath: string) {
    this.#path = join(monitorState, "rung-watch.json");
    this.#logPath = logPath;
    this.#held = read(this.#path);
  }

  /** What is currently believed dead, for the report to list between transitions. */
  rotted(): Rotted[] {
    return [...this.#held.rotted];
  }

  /** What the last read covered, so a quiet hour and an unread log are never the same reading. */
  window(): Window | null {
    return this.#held.window;
  }

  /**
   * Reads what the runtime decided since the last read and says what moved. The lanes' own
   * membership is passed in because a lane standing a rung down is already answering lower down
   * its chain, and that is not a switch anybody needs telling about twice.
   */
  watch(standingDown: readonly string[], now: Date = new Date()): Transition[] {
    const reading = readDecisions(this.#logPath, this.#held.cursor, now);
    const before = { serving: { ...this.serving(standingDown) }, rotted: this.#held.rotted };
    const after = decided(before, reading.decisions);

    this.#hold({
      cursor: reading.cursor,
      serving: after.serving,
      rotted: after.rotted,
      window: reading.window,
    });
    return moved(before, after);
  }

  #hold(watched: Watched): void {
    this.#held = watched;
    writePrivateFile(this.#path, `${JSON.stringify(this.#held, null, 2)}\n`);
  }

  /**
   * What the sweep found, folded into the same set the log feeds, so a rung is announced once
   * however it was discovered. Only two of the three answers are evidence: a rung that answered
   * exists, and a **404** is a name nothing answers to. Everything else — a 429, a 5xx, a timeout —
   * is a living rung refusing a request, and it leaves what is believed about the rung alone.
   */
  swept(findings: readonly Swept[], now: Date = new Date()): Transition[] {
    const before = { serving: this.#held.serving, rotted: this.#held.rotted };
    const after = { serving: before.serving, rotted: sweptRotted(before.rotted, findings, now) };
    this.#hold({ ...this.#held, rotted: after.rotted });
    return moved(before, after);
  }

  /**
   * A rung the Owner has taken out of its chain. It is dropped rather than kept as recovered: what
   * a rotted entry is for is telling them there is a removal to make, and this one is made.
   */
  forget(rung: string): void {
    this.#hold({ ...this.#held, rotted: this.#held.rotted.filter((one) => one.rung !== rung) });
  }

  /** The rung each lane answers on as far as anything knows: what was seen, else its primary. */
  serving(standingDown: readonly string[]): Record<string, string> {
    const seen: Record<string, string> = {};
    for (const lane of chainLanes) {
      const primary = lane.rungs.find((rung) => !standingDown.includes(modelRef(rung)));
      const answering = this.#held.serving[lane.name] ?? (primary && modelRef(primary));
      if (answering !== undefined) seen[lane.name] = answering;
    }
    return seen;
  }
}

type State = { serving: Record<string, string>; rotted: Rotted[] };

/**
 * A rung that answered exists, whatever else it did: a 429 is a living model refusing a request,
 * and only `model_not_found` is a name nothing answers to.
 */
function decided(before: State, decisions: readonly Decision[]): State {
  let serving = { ...before.serving };
  let rotted = [...before.rotted];
  for (const decision of decisions) {
    const lane = laneHolding(decision.candidate);
    if (lane === undefined) continue;
    if (decision.reason === "model_not_found") {
      rotted = [
        ...rotted.filter((one) => one.rung !== decision.candidate),
        {
          rung: decision.candidate,
          lane: lane.name,
          said: decision.said ?? "it said nothing a reader could keep",
          at: decision.at,
        },
      ];
      continue;
    }
    rotted = rotted.filter((one) => one.rung !== decision.candidate);
    if (decision.decision === "candidate_succeeded") serving[lane.name] = decision.candidate;
  }
  return { serving, rotted };
}

/**
 * The sweep's findings against what is already believed. A rung that answered is taken out of the
 * set whatever put it there, and one that 404'd goes in with the words it 404'd in — the sweep is
 * the same reading as the log's, taken by asking rather than by waiting.
 */
function sweptRotted(held: readonly Rotted[], findings: readonly Swept[], now: Date): Rotted[] {
  let rotted = [...held];
  for (const found of findings) {
    if (found.answered) {
      rotted = rotted.filter((one) => one.rung !== found.rung);
      continue;
    }
    if (found.status !== 404) continue;
    rotted = [
      ...rotted.filter((one) => one.rung !== found.rung),
      { rung: found.rung, lane: found.lane, said: found.said, at: now.toISOString() },
    ];
  }
  return rotted;
}

function moved(before: State, after: State): Transition[] {
  const switched = Object.entries(after.serving)
    .filter(([lane, rung]) => before.serving[lane] !== undefined && before.serving[lane] !== rung)
    .map(([lane, rung]): Transition => ({
      kind: "a lane switch",
      said: `the ${lane} lane is answering on ${rung} rather than ${before.serving[lane]}.`,
    }));

  const rotted = after.rotted
    .filter((one) => !before.rotted.some((held) => held.rung === one.rung))
    .map((one): Transition => ({
      kind: "a rotted rung",
      said: `${one.rung} answers to no such name on the ${one.lane} lane: "${one.said}". It is still in the chain, and every turn that reaches it pays for it until you take it out.`,
    }));

  const recovered = before.rotted
    .filter((one) => !after.rotted.some((held) => held.rung === one.rung))
    .map((one): Transition => ({
      kind: "a recovered rung",
      said: `${one.rung} is answering to its name again on the ${one.lane} lane.`,
    }));

  return [...switched, ...rotted, ...recovered];
}

/** A state file that will not parse is read as nothing known, which costs one repeated report. */
function read(path: string): Watched {
  const fresh: Watched = { cursor: null, serving: {}, rotted: [], window: null };
  if (!existsSync(path)) return fresh;
  try {
    const held = JSON.parse(readFileSync(path, "utf8")) as Watched;
    return {
      cursor: held.cursor ?? null,
      serving: typeof held.serving === "object" && held.serving !== null ? held.serving : {},
      rotted: Array.isArray(held.rotted) ? held.rotted : [],
      window: held.window ?? null,
    };
  } catch {
    return fresh;
  }
}
