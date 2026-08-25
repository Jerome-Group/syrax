/**
 * The calendar half of the academic pair, and the shape of refresh-then-read: Syrax asks
 * `academic-os` for its own pull-only Refresh, then reads the mirror that Refresh wrote.
 *
 * **Refresh is a read that caches**, so nothing here is confirmed: it never touches the Live
 * calendar. Promotion is the write, and it is the one the Owner taps for (#10).
 *
 * **Routine is never read.** It is sleep, meals and exercise, and answering *what's due* from it
 * would bury the one deadline that mattered under eight recurring blocks. Two roles are named here
 * and the third is not reachable rather than filtered out.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writePrivateFile } from "../adapter/private-state.ts";
import {
  occurrencesIn,
  type MirroredItem,
  type Occurrence,
  type Unexpanded,
} from "./occurrences.ts";
import { Products, writeTimeoutMs } from "./products.ts";

/** The two Owned calendars a commitment can sit on. Routine is the third and is not one of them. */
export const dueRoles = ["Academic", "Commitments"] as const;

/** How far ahead *what's due* looks when the Owner names no horizon of their own. */
export const dueWindowDays = 7;

/** One calendar as the mirror describes itself: when it was last pulled, and whether that took. */
export type CalendarState = {
  role: string;
  lastSuccessfulRefresh: string | null;
  freshness: string;
  /** Null where no mirror has been written yet, which is a Refresh that has never succeeded. */
  items: number | null;
};

export type Due = {
  refreshed: boolean;
  /** What the product said about its own Refresh, relayed rather than interpreted. */
  said: string;
  from: string;
  to: string;
  calendars: CalendarState[];
  due: DueItem[];
  /** Recurring rules the mirror holds and this side does not walk. Stated, never dropped. */
  unexpanded: Unexpanded[];
};

export type DueItem = {
  summary: string;
  role: string;
  at: string;
  allDay: boolean;
};

/**
 * Refresh, then read. A Refresh that failed does not stop the read: it may still have advanced
 * other calendars, and the mirror says per calendar when it was last pulled — so the answer carries
 * stale state *and says it is stale* rather than being no answer at all.
 */
export async function whatIsDue(
  products: Products,
  options: { days?: number; now?: Date } = {},
): Promise<Due> {
  const now = options.now ?? new Date();
  const ran = await products.academicOs(["calendar", "refresh"]);
  const window = {
    from: now,
    to: endOfDay(now, (options.days ?? dueWindowDays) - 1),
  };

  const calendars: CalendarState[] = [];
  const items: MirroredItem[] = [];
  for (const role of dueRoles) {
    const mirror = await readMirror(products, role);
    calendars.push({
      role,
      lastSuccessfulRefresh: mirror?.lastSuccessfulRefresh ?? null,
      freshness: mirror === null ? "never pulled" : (mirror.freshness ?? "unknown"),
      items: mirror === null ? null : mirror.items.length,
    });
    items.push(...(mirror?.items ?? []));
  }

  const { occurrences, unexpanded } = occurrencesIn(items, window);
  return {
    refreshed: ran.ok,
    said: ran.ok ? "the calendar was refreshed" : `the Refresh did not finish: ${ran.said}`,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    calendars,
    due: occurrences.map(asDue),
    unexpanded,
  };
}

function asDue(occurrence: Occurrence): DueItem {
  return {
    summary: occurrence.summary,
    role: occurrence.role,
    at: occurrence.startsAt.toISOString(),
    allDay: occurrence.allDay,
  };
}

/** Today alone, which is what the day-ahead half of the morning brief is made of. */
export function today(now: Date = new Date()): { days: number; now: Date } {
  return { days: 1, now: startOfDay(now) };
}

type Mirror = {
  lastSuccessfulRefresh?: string | null;
  freshness?: string;
  items: MirroredItem[];
};

/**
 * The file the Refresh wrote, read in the shape `academic-os` writes it. A mirror that is missing or
 * unparseable is read as *never pulled*: this side states what it was handed and reconstructs
 * nothing, because a half-written calendar reported as a day's plan is worse than saying there is
 * no calendar to read.
 */
async function readMirror(products: Products, role: string): Promise<Mirror | null> {
  const path = join(
    products.paths.academicOsState,
    "calendar",
    "mirrors",
    `${role.toLowerCase()}.json`,
  );
  try {
    const mirror = JSON.parse(await readFile(path, "utf8")) as Mirror;
    return Array.isArray(mirror?.items) ? mirror : null;
  } catch {
    return null;
  }
}

/**
 * A Proposal: private, invisible to Live, and trivially discarded — so it is not confirmed. Gating
 * it would teach the Owner to tap through confirmations, and the tap that matters is Promotion's,
 * which shows the conflict check a Proposal has already done (#10).
 */
export async function propose(
  products: Products,
  item: Record<string, unknown>,
): Promise<{ ok: boolean; report: unknown; said: string; input: string }> {
  const input = join(products.paths.academicState, "proposal-input.json");
  writePrivateFile(
    input,
    `${JSON.stringify(
      { schemaVersion: 1, source: { kind: "instruction", reference: "syrax" }, item },
      null,
      2,
    )}\n`,
  );
  const ran = await products.academicOs(["calendar", "propose", "--input", input]);
  return { ok: ran.ok, report: ran.report, said: ran.said, input };
}

/**
 * A Promotion, which is the write. `academic-os` Refreshes first and blocks on stale state, a
 * conflict that has appeared, or a Proposal whose provider version moved — and those refusals are
 * relayed rather than worked around: what the Owner confirmed was this Proposal against that check.
 */
export async function promote(
  products: Products,
  proposalId: string,
): Promise<{ ok: boolean; report: unknown; said: string }> {
  const ran = await products.academicOs(["calendar", "promote", proposalId], writeTimeoutMs);
  return { ok: ran.ok, report: ran.report, said: ran.said };
}

function startOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function endOfDay(now: Date, plusDays: number): Date {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + plusDays);
  day.setHours(23, 59, 59, 999);
  return day;
}
