/**
 * A calendar mirror is not a day's timetable, and this is the difference between them: `academic-os`
 * keeps recurring masters and their dated exceptions compact rather than storing one row per week,
 * so the events falling inside a window have to be worked out from the rules the mirror holds.
 *
 * What is expanded is what a semester is made of — a class every week, a thing every day — and what
 * is not is **said** rather than dropped: a monthly or yearly rule comes back under `unexpanded`,
 * so a brief that cannot see something never reads as a morning with nothing in it.
 *
 * The clock is the machine's own, which is the Owner's: `academic-os` pins the mini to
 * `Asia/Singapore` and refuses to install its Refresh anywhere else, so a second timezone stated
 * here would be a second answer to what *today* means.
 */

/** One row of a mirror, in the shape `academic-os` writes it. */
export type MirroredItem = {
  actualCalendarRole?: string;
  access?: string;
  event?: CalendarEvent;
};

export type CalendarEvent = {
  id?: string;
  summary?: string;
  status?: string;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: { date?: string; dateTime?: string };
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  transparency?: string;
};

/** One thing on one day: what it is called, when it starts, and which calendar it came from. */
export type Occurrence = {
  id: string;
  summary: string;
  role: string;
  startsAt: Date;
  /** An all-day milestone has a date and no time, and is stated as a day rather than as a minute. */
  allDay: boolean;
};

/** A rule this expander does not walk, named with the rule itself so the Owner can read it. */
export type Unexpanded = { id: string; summary: string; recurrence: string[] };

export type Window = { from: Date; to: Date };

/** Eleven years of daily steps: a master older than that is a rule nobody is still keeping. */
const mostSteps = 4000;

/**
 * An all-day entry has a day rather than a moment, so it is inside a window that opened **during**
 * that day: a deadline dated today is still due at four in the afternoon, and asking *what's due*
 * after midnight must not lose it. A timed entry is held to the window as it stands — a lecture that
 * started this morning is over, not due.
 */
function opensFor(occurrence: Occurrence, window: Window): Date {
  if (!occurrence.allDay) return window.from;
  const from = window.from;
  return new Date(from.getFullYear(), from.getMonth(), from.getDate());
}

export function occurrencesIn(
  items: readonly MirroredItem[],
  window: Window,
): { occurrences: Occurrence[]; unexpanded: Unexpanded[] } {
  const occurrences: Occurrence[] = [];
  const unexpanded: Unexpanded[] = [];
  const overridden = overriddenStarts(items);

  for (const item of items) {
    const event = item.event;
    if (event === undefined || event.status === "cancelled") continue;
    const role = item.actualCalendarRole ?? "";
    if (event.recurrence === undefined || event.recurrence.length === 0) {
      const one = at(event, event.start, role);
      if (one !== null && inside(one.startsAt, { ...window, from: opensFor(one, window) })) {
        occurrences.push(one);
      }
      continue;
    }
    const rule = weeklyOrDaily(event.recurrence);
    if (rule === null) {
      unexpanded.push({
        id: event.id ?? "",
        summary: event.summary ?? "(untitled)",
        recurrence: event.recurrence,
      });
      continue;
    }
    occurrences.push(...expand(event, rule, role, window, overridden));
  }

  return { occurrences: occurrences.sort(byStart), unexpanded };
}

function byStart(one: Occurrence, other: Occurrence): number {
  return +one.startsAt - +other.startsAt;
}

/**
 * A dated exception carries the occurrence it replaces, and it is already in the mirror as a row of
 * its own — so the master's own occurrence at that moment is suppressed rather than counted twice.
 * A cancelled exception suppresses it and adds nothing, which is a class that was called off.
 */
function overriddenStarts(items: readonly MirroredItem[]): Set<string> {
  const overridden = new Set<string>();
  for (const { event } of items) {
    if (event?.recurringEventId === undefined) continue;
    // Read through the same clock the expansion uses: an all-day date parsed as UTC would miss the
    // occurrence it replaces by the machine's own offset, and quietly leave both in the day.
    const original = startMoment(event.originalStartTime);
    if (original !== null) overridden.add(`${event.recurringEventId}@${+original}`);
  }
  return overridden;
}

type Repeat = {
  everyDays: number;
  onWeekdays: number[] | null;
  count: number | null;
  until: Date | null;
};

const weekdays = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/**
 * The two frequencies a semester is written in. A rule naming anything else — monthly, yearly, or a
 * `BYMONTHDAY` refinement this does not read — is refused here rather than approximated, because a
 * date guessed from a rule is exactly the fabrication the front lane is told never to commit.
 */
function weeklyOrDaily(recurrence: readonly string[]): Repeat | null {
  const rule = recurrence.find((line) => line.startsWith("RRULE:"));
  if (rule === undefined) return null;
  const parts = new Map(
    rule
      .slice("RRULE:".length)
      .split(";")
      .map((pair) => pair.split("=") as [string, string]),
  );
  const frequency = parts.get("FREQ");
  if (frequency !== "WEEKLY" && frequency !== "DAILY") return null;
  if ([...parts.keys()].some((key) => !readableParts.has(key))) return null;
  const interval = Number(parts.get("INTERVAL") ?? "1");
  if (!Number.isSafeInteger(interval) || interval < 1) return null;
  const byDay = parts.get("BYDAY");
  const onWeekdays =
    byDay === undefined
      ? null
      : byDay.split(",").map((day) => weekdays.indexOf(day.trim().toUpperCase()));
  if (onWeekdays?.some((day) => day < 0)) return null;
  return {
    everyDays: frequency === "DAILY" ? interval : interval * 7,
    onWeekdays,
    count: parts.has("COUNT") ? Number(parts.get("COUNT")) : null,
    until: parts.has("UNTIL") ? untilDate(parts.get("UNTIL")!) : null,
  };
}

const readableParts = new Set(["FREQ", "INTERVAL", "BYDAY", "COUNT", "UNTIL", "WKST"]);

/** `UNTIL` is basic-format UTC — `20261115T235900Z` — which `Date` does not parse as it stands. */
function untilDate(value: string): Date | null {
  const stamp = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(
    value.trim().toUpperCase(),
  );
  if (stamp === null) return null;
  const [, year, month, day, hour = "00", minute = "00", second = "00"] = stamp;
  return new Date(Date.UTC(+year!, +month! - 1, +day!, +hour, +minute, +second));
}

/**
 * The master walked forward a day at a time. Stepping by days rather than by the rule's own period
 * is what lets one loop carry both frequencies and `BYDAY` — a weekly rule naming three days is
 * three occurrences in each of its weeks, and no arithmetic over the rule states that as plainly.
 */
function expand(
  event: CalendarEvent,
  rule: Repeat,
  role: string,
  window: Window,
  overridden: ReadonlySet<string>,
): Occurrence[] {
  const first = at(event, event.start, role);
  if (first === null) return [];
  const weeklyStep = rule.onWeekdays === null ? rule.everyDays : 1;
  const occurrences: Occurrence[] = [];
  let counted = 0;

  for (let step = 0; step < mostSteps; step++) {
    const startsAt = plusDays(first.startsAt, step * weeklyStep);
    if (startsAt > window.to) break;
    if (rule.until !== null && startsAt > rule.until) break;
    if (rule.onWeekdays !== null && !rule.onWeekdays.includes(startsAt.getDay())) continue;
    if (rule.onWeekdays !== null && !inCycle(first.startsAt, startsAt, rule.everyDays)) continue;
    counted += 1;
    if (rule.count !== null && counted > rule.count) break;
    if (!inside(startsAt, { ...window, from: opensFor(first, window) })) continue;
    if (overridden.has(`${first.id}@${+startsAt}`)) continue;
    occurrences.push({ ...first, startsAt });
  }
  return occurrences;
}

/** An interval greater than one skips whole weeks, and the master's own week is the one kept. */
function inCycle(first: Date, startsAt: Date, everyDays: number): boolean {
  if (everyDays <= 7) return true;
  const weeksApart = Math.floor((startOfWeek(startsAt) - startOfWeek(first)) / weekMs);
  return weeksApart % (everyDays / 7) === 0;
}

const dayMs = 86_400_000;
const weekMs = 7 * dayMs;

function startOfWeek(when: Date): number {
  const day = new Date(when.getFullYear(), when.getMonth(), when.getDate() - when.getDay());
  return +day;
}

/** Days rather than milliseconds, so a step across a daylight boundary keeps the wall-clock time. */
function plusDays(from: Date, days: number): Date {
  const moved = new Date(from);
  moved.setDate(moved.getDate() + days);
  return moved;
}

function inside(startsAt: Date, window: Window): boolean {
  return startsAt >= window.from && startsAt <= window.to;
}

function at(event: CalendarEvent, start: CalendarEvent["start"], role: string): Occurrence | null {
  const startsAt = startMoment(start);
  if (startsAt === null) return null;
  return {
    allDay: start?.date !== undefined,
    id: event.id ?? "",
    summary: event.summary ?? "(untitled)",
    role,
    startsAt,
  };
}

/**
 * When a start is, on the machine's own clock. An all-day date is that day here rather than midnight
 * UTC, which in Singapore is the evening before — a deadline that would otherwise land in yesterday.
 */
function startMoment(start: CalendarEvent["start"]): Date | null {
  const when = start?.dateTime ?? start?.date;
  if (when === undefined) return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(when);
  const moment = day === null ? new Date(when) : new Date(+day[1]!, +day[2]! - 1, +day[3]!);
  return Number.isNaN(+moment) ? null : moment;
}
