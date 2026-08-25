/**
 * The daily brief: the one message the Academic chat posts each morning without being asked.
 *
 * **It is posted on an empty day too**, because its absence is the signal — Syrax is a chat surface
 * whose death shows within one message, and this is the daily heartbeat that makes a quiet morning
 * mean something (ADR-0005, ADR-0013). Which is also why it is composed here rather than asked of a
 * model: a brief that depends on a free-tier turn succeeding is a heartbeat that stops when a
 * provider does, and the Owner would read that as Syrax being down.
 *
 * The order is the Owner's (#10): the day ahead first, because it is the part with a decision
 * attached; then what arrived overnight, named and not detailed; then the sync verdict, always, and
 * carrying the one line only they can act on. Audit drift is not in it — nothing schedules an audit,
 * so on any given morning there is no fresh observation to report drift from.
 */

import { chats } from "../adapter/chats.ts";
import type { Deployment } from "../adapter/deployment.ts";
import { ChatSurface } from "../surface/chat-surface.ts";
import { today, whatIsDue, type DueItem } from "./calendar.ts";
import {
  announcementsSince,
  reLoginLine,
  syncVerdict,
  type Announcement,
  type SyncVerdict,
} from "./ntulearn.ts";
import type { Products } from "./products.ts";

/** What arrived *overnight* is what arrived since this time yesterday. */
export const overnightMs = 24 * 60 * 60_000;

export type Brief = {
  day: DueItem[];
  arrived: Announcement[];
  verdict: SyncVerdict;
  text: string;
};

/**
 * The modules root is the Academic chat's own search scope, read from the one place configuration
 * names it: what the brief reads and what the chat searches are the same root by construction
 * (ADR-0004).
 */
export function modulesRoot(deployment: Deployment): string {
  return deployment.searchScopes[chats.academic.id] ?? "";
}

export async function composeBrief(
  deployment: Deployment,
  products: Products,
  now: Date = new Date(),
): Promise<Brief> {
  const due = await whatIsDue(products, today(now));
  const arrived = await announcementsSince(modulesRoot(deployment), new Date(+now - overnightMs));
  const verdict = await syncVerdict(products);
  return { day: due.due, arrived, verdict, text: briefText({ day: due.due, arrived, verdict }) };
}

/** Posted into Academic, which is the chat whose corpus it draws on: the follow-up lands where the
 * context to answer it already is. A cleared carrier is recreated by the send, as any other is. */
export async function postBrief(deployment: Deployment, brief: Brief): Promise<void> {
  await ChatSurface.open(deployment).post(chats.academic.id, brief.text);
}

export function briefText(brief: Omit<Brief, "text">): string {
  return [dayAhead(brief.day), overnight(brief.arrived), verdictLine(brief.verdict)].join("\n\n");
}

function dayAhead(day: readonly DueItem[]): string {
  if (day.length === 0) return "Today: nothing on the calendar.";
  return ["Today:", ...day.map((item) => `- ${at(item)} ${item.summary}`)].join("\n");
}

function at(item: DueItem): string {
  if (item.allDay) return "all day —";
  const when = new Date(item.at);
  return `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")} —`;
}

/** Named and not detailed: the module and the title, which is what a follow-up question needs. */
function overnight(arrived: readonly Announcement[]): string {
  if (arrived.length === 0) return "Overnight: no new announcements.";
  return ["Overnight:", ...arrived.map((one) => `- ${one.module}: ${one.title}`)].join("\n");
}

function verdictLine(verdict: SyncVerdict): string {
  const stated = `Sync: ${verdict.verdict}${verdict.message === "" ? "" : ` — ${verdict.message}`}.`;
  return verdict.needsLogin ? `${stated} ${reLoginLine}` : stated;
}
