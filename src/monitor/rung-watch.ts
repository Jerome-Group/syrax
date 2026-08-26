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

import { callBehind, modelRef } from "../adapter/lane.ts";
import { chainLanes, laneHolding, rungNamed } from "../adapter/lanes.ts";
import { writePrivateFile } from "../adapter/private-state.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Cursor, type Decision, readDecisions } from "./fallback-log.ts";
import type { Swept } from "./rung-sweep.ts";
import type { Transition } from "./usage-report.ts";

/**
 * What a provider refusing a request for its **size** answers with, and the whole of what tells that
 * refusal from a rate limit or a context overflow — all three are worded alike and only this
 * separates them (ADR-0035).
 */
const sizeRefusalStatus = 413;

/** A rung that answered to no such name, and the words the provider refused it in. */
export type Rotted = { rung: string; lane: string; said: string; at: string };

/**
 * A rung whose written largest call the real traffic has passed: what its file says, what a refusal
 * proved, and the words that proved it. This is a **configuration defect** rather than a metric —
 * the invariant that says the rung fits was checked against the first number and the second is the
 * one that reached the provider (ADR-0035).
 */
export type Outgrown = {
  rung: string;
  lane: string;
  /** What the rung's file says it is asked for, and what a refusal says it was actually asked. */
  wrote: number;
  saw: number;
  said: string;
  at: string;
};

export type Window = { from: string | null; to: string; unknown: string | null };

type Watched = {
  cursor: Cursor | null;
  /** The rung each lane was last seen answering on. */
  serving: Record<string, string>;
  rotted: Rotted[];
  outgrown: Outgrown[];
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

  /** The rungs whose written largest call the traffic has passed, listed the same way. */
  outgrown(): Outgrown[] {
    return [...this.#held.outgrown];
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
    const before = {
      serving: { ...this.serving(standingDown) },
      rotted: this.#held.rotted,
      outgrown: this.#held.outgrown,
    };
    const after = decided(before, reading.decisions);

    this.#hold({
      cursor: reading.cursor,
      serving: after.serving,
      rotted: after.rotted,
      outgrown: after.outgrown,
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
    const before = {
      serving: this.#held.serving,
      rotted: this.#held.rotted,
      outgrown: this.#held.outgrown,
    };
    const after = { ...before, rotted: sweptRotted(before.rotted, findings, now) };
    this.#hold({ ...this.#held, rotted: after.rotted });
    return moved(before, after);
  }

  /**
   * A rung the Owner has taken out of its chain. It is dropped rather than kept as recovered: what
   * a rotted entry is for is telling them there is a removal to make, and this one is made.
   */
  /**
   * The finding is dropped when the rung goes back to be tried, and only then. It is what the report
   * lists while the rung is out, so it has to outlive the stand down it caused — but it must not
   * outlive the return, or the next sweep would stand the rung down again off the same refusal and
   * the re-test would never happen (ADR-0035). A rung still too large writes a fresh one.
   */
  forgetOutgrown(rung: string): void {
    this.#hold({
      ...this.#held,
      outgrown: this.#held.outgrown.filter((one) => one.rung !== rung),
    });
  }

  forget(rung: string): void {
    this.#hold({
      ...this.#held,
      rotted: this.#held.rotted.filter((one) => one.rung !== rung),
      outgrown: this.#held.outgrown.filter((one) => one.rung !== rung),
    });
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

type State = { serving: Record<string, string>; rotted: Rotted[]; outgrown: Outgrown[] };

/**
 * A rung that answered exists, whatever else it did: a 429 is a living model refusing a request,
 * and only `model_not_found` is a name nothing answers to.
 */
function decided(before: State, decisions: readonly Decision[]): State {
  let serving = { ...before.serving };
  let rotted = [...before.rotted];
  let outgrown = [...before.outgrown];
  for (const decision of decisions) {
    const lane = laneHolding(decision.candidate);
    if (lane === undefined) continue;
    const passed = outgrewItsFigure(decision, lane.name);
    if (passed !== undefined) {
      outgrown = [...outgrown.filter((one) => one.rung !== passed.rung), passed];
    }
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
  // A figure somebody has since corrected has nothing left to report, and a finding that outlived
  // its own fix would tell the Owner to make a change already made.
  outgrown = outgrown.filter((one) => {
    const rung = rungNamed(one.rung);
    // A rung no chain holds any more has no figure left to correct, and nothing offers a way to
    // clear it: keeping the entry would leave a line in every report for ever.
    return rung !== undefined && rung.largestCallTokens < one.saw;
  });
  return { serving, rotted, outgrown };
}

/**
 * The only observation of a real call size anything here can make. A provider refusing a request for
 * its size names the total it charged, so the call behind it is that total less what the rung
 * reserves — and a call larger than the figure the rung's ceiling was checked against means the
 * check was run on a number the traffic has left behind.
 *
 * **It can only ever be read off a refusal**, which is the honest limit of it: a call that was
 * served says nothing about its own size anywhere in the log, so a figure is contradicted after a
 * rung has already refused rather than before. That is late, and it is later than never — the
 * invariant on its own stayed green through every one of #204's refusals.
 *
 * The status is what makes the reading safe, and the words alone would not be. *Requested* is also
 * how a **context overflow** is worded — the pinned runtime's own overflow table matches
 * `requested … tokens` — and that is a call too large for the model rather than for the plan, whose
 * number is two orders of magnitude out. Read from one of those, this would tell the Owner to
 * correct a figure to something the invariant forbids.
 */
function outgrewItsFigure(decision: Decision, lane: string): Outgrown | undefined {
  if (decision.status !== sizeRefusalStatus) return undefined;
  const requested = requestedTokens(decision.saidInFull) ?? requestedTokens(decision.said);
  const rung = rungNamed(decision.candidate);
  if (requested === undefined || rung === undefined) return undefined;
  const saw = callBehind(rung, requested);
  if (saw <= rung.largestCallTokens) return undefined;
  return {
    rung: decision.candidate,
    lane,
    wrote: rung.largestCallTokens,
    saw,
    said: decision.said ?? "",
    at: decision.at,
  };
}

/**
 * The number out of the provider's own words. It is parsed rather than read from a field because
 * the runtime carries the refusal as a message preview and nothing else — there is no token count
 * on a decision record, on any record, which is why this is the shape it is.
 */
function requestedTokens(said: string | null): number | undefined {
  const found = said?.match(/Requested\s+([\d,]+)/i);
  if (found === null || found === undefined) return undefined;
  const asked = Number(found[1]!.replaceAll(",", ""));
  return Number.isFinite(asked) ? asked : undefined;
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

  const passed = after.outgrown
    .filter((one) => !before.outgrown.some((held) => held.rung === one.rung))
    .map((one): Transition => ({
      kind: "an outgrown call size",
      said: `${one.rung} is written for a largest call of ${one.wrote} tokens on the ${one.lane} lane and was asked for ${one.saw}: "${one.said}". The ceiling was checked against the smaller number, so the check has been passing on a figure the traffic left behind — correct it in the rung's own file.`,
    }));

  const recovered = before.rotted
    .filter((one) => !after.rotted.some((held) => held.rung === one.rung))
    .map((one): Transition => ({
      kind: "a recovered rung",
      said: `${one.rung} is answering to its name again on the ${one.lane} lane.`,
    }));

  return [...switched, ...rotted, ...passed, ...recovered];
}

/** A state file that will not parse is read as nothing known, which costs one repeated report. */
function read(path: string): Watched {
  const fresh: Watched = { cursor: null, serving: {}, rotted: [], outgrown: [], window: null };
  if (!existsSync(path)) return fresh;
  try {
    const held = JSON.parse(readFileSync(path, "utf8")) as Watched;
    return {
      cursor: held.cursor ?? null,
      serving: typeof held.serving === "object" && held.serving !== null ? held.serving : {},
      rotted: Array.isArray(held.rotted) ? held.rotted : [],
      outgrown: Array.isArray(held.outgrown) ? held.outgrown : [],
      window: held.window ?? null,
    };
  } catch {
    return fresh;
  }
}
