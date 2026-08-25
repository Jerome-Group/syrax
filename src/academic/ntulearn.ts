/**
 * The NTULearn half of the pair: the watchdog's verdict, the announcements a sync has already
 * written to disk, and the sync itself — the one write of the two that spends a saved SSO session.
 *
 * Both reads are of files the product wrote for a reader (`latest.json` is described in its own
 * README as the stable input for a delivery channel). Nothing here re-derives a verdict from a run
 * log or re-walks NTULearn: a second opinion about a run that already happened is a number no run
 * produced.
 */

import type { Dirent } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { Products, writeTimeoutMs } from "./products.ts";

export type SyncVerdict = {
  verdict: "green" | "yellow" | "red" | "unknown";
  message: string;
  /** When the run finished, or null where no watchdog has ever written a digest here. */
  at: string | null;
  /** The run's own evidence, relative to the state directory, where there is a run to point at. */
  runLog: string | null;
  /** What the digest says went wrong, which is not the same question as what colour it is. */
  failed: Failed;
  /**
   * The one failure only the Owner can clear. `npm run login` opens an interactive SSO/MFA window,
   * which cannot be driven from a chat — so the chat's job is to say it is needed and stop there.
   */
  needsLogin: boolean;
};

/**
 * A red is not a reason, and reading it as one is what this distinguishes (#180). The first live
 * brief carried a red whose cause was a Drive mount the destinations no longer sat under, and told
 * the Owner to re-open their NTULearn session — an instruction that would have cost them an
 * interactive sign-in and fixed nothing.
 */
export type Failed = "nothing" | "the session" | "something else" | "unclear";

/** The digest ntulearn's watchdog writes after its ~05:00 run. */
export async function syncVerdict(products: Products): Promise<SyncVerdict> {
  const path = join(products.paths.ntulearnState, "latest.json");
  let digest: { verdict?: unknown; message?: unknown; timestamp?: unknown; runLog?: unknown };
  try {
    digest = JSON.parse(await readFile(path, "utf8")) as typeof digest;
  } catch {
    return {
      verdict: "unknown",
      message: "no watchdog run has been written to read.",
      at: null,
      runLog: null,
      failed: "unclear",
      needsLogin: false,
    };
  }
  const verdict = isVerdict(digest.verdict) ? digest.verdict : "unknown";
  const message = typeof digest.message === "string" ? digest.message : "";
  const failed = whatFailed(verdict, message);
  return {
    verdict,
    message,
    at: typeof digest.timestamp === "string" ? digest.timestamp : null,
    runLog: typeof digest.runLog === "string" ? digest.runLog : null,
    failed,
    needsLogin: failed === "the session",
  };
}

/**
 * What the digest blames, read from the digest's own sentences. `ntulearn`'s watchdog writes a small
 * closed set of them (`src/watchdog/verdict.mjs`), and each one already names its own cause — so
 * this recognises the product's wording rather than inventing a classification of its own.
 *
 * A message none of them matches is **unclear** rather than assigned to the likelier of the two: a
 * sentence this side does not recognise is a sentence a later version of the product wrote, and
 * guessing at it is how the wrong instruction gets given confidently.
 */
function whatFailed(verdict: SyncVerdict["verdict"], message: string): Failed {
  if (verdict === "green") return "nothing";
  if (verdict === "unknown") return "unclear";
  if (theSessionLapsed.test(message)) return "the session";
  if (crashThatCapturedNothing.test(message)) return "unclear";
  return blamedElsewhere.some((shape) => shape.test(message)) ? "something else" : "unclear";
}

/**
 * The watchdog's own sentence for a lapsed session, and the three phrases it detects one by — a
 * crash whose captured tail carries one of them is the same failure arriving down another path.
 */
const theSessionLapsed =
  /session lapsed|the saved session is no longer signed in|not signed in while downloading|http 401/i;

/**
 * A crash carries whatever it captured, and `(none)` is the watchdog's own placeholder for having
 * captured nothing. A crash that names nothing has not blamed anything, so it is unclear rather than
 * *something else* — the difference the Owner reads is between *look here* and *look somewhere*.
 */
const crashThatCapturedNothing = /crash\/timeout[^]*stderr tail: \(none\)/i;

/** Every other shape the watchdog writes, each of which names a cause that is not the session. */
const blamedElsewhere = [
  /is unreachable/i,
  /drive not mounted/i,
  /a run was already going/i,
  /sync failed:/i,
  /verify failed:/i,
  /crash\/timeout/i,
];

function isVerdict(value: unknown): value is SyncVerdict["verdict"] {
  return value === "green" || value === "yellow" || value === "red";
}

/** Where the run's own evidence is, for a failure this side can only say it does not recognise. */
export function unplacedLine(runLog: string | null): string {
  const where = runLog === null ? "the watchdog's run log" : `the run log \`${runLog}\``;
  return `What failed is not something Syrax can place, so take the run itself as the authority: ${where}, under ntulearn's state directory.`;
}

export const reLoginLine =
  "The saved NTULearn session may have lapsed: `npm run login` in the ntulearn checkout is the only thing that clears this, and only you can do it.";

export type Announcement = {
  module: string;
  title: string;
  /** When it was posted, as the document itself dates it. */
  at: string;
  /** Which of the three the date came from, so a fallback is never read as the real thing. */
  dated: Dated;
};

export type Dated = "its own Created line" | "the day in its filename" | "when the sync wrote it";

/** How far below the modules root an `Announcements/` folder is looked for: semester, module, importer root. */
const mostDepth = 6;

/**
 * What arrived, read off the disk a sync already wrote to rather than by asking NTULearn again. The
 * modules root is the one configuration binds to the Academic chat's search scope, so *what Syrax
 * reads* and *what Syrax searches* cannot drift apart into two roots.
 *
 * **What arrived is when it was posted, never when a sync got round to writing it** (#182). On an
 * ordinary morning the two agree — a run over a course with nothing new writes nothing at all — and
 * they come apart exactly when a sync catches up after a gap, which is the morning a brief would
 * otherwise offer a year-old announcement as overnight news.
 */
export async function announcementsSince(
  modulesRoot: string,
  since: Date,
): Promise<Announcement[]> {
  const arrived: Announcement[] = [];
  for await (const folder of announcementFolders(modulesRoot, mostDepth)) {
    for (const file of await files(folder)) {
      if (file.startsWith(".")) continue;
      const posted = await postedAt(join(folder, file), since);
      if (posted === null) continue;
      arrived.push({
        module: moduleOf(modulesRoot, folder),
        title: titleOf(file),
        at: posted.at.toISOString(),
        dated: posted.dated,
      });
    }
  }
  return arrived.sort((one, other) => one.at.localeCompare(other.at));
}

/** `ntulearn` names each announcement for the day it was posted, and the rest is its title. */
const dayInName = /^(\d{4}-\d{2}-\d{2}) (.+)$/;

/** The precise moment, written into the document's own header beside `Modified:`. */
const createdInBody = /^-\s*Created:\s*(\S+)\s*$/m;

/**
 * How far into a document that header is looked for. It sits under the title, and an announcement's
 * title can run to a paragraph — so this is sized for a long one rather than for a typical one, and
 * a document whose header is further in than this falls back to the day in its filename and says so.
 */
const headerBytes = 4096;

/**
 * When one announcement was posted, or null where it was posted before the window. The document's
 * own `Created:` line is the authority; its filename's day stands in where there is none, and only a
 * file carrying neither falls back to when the sync wrote it — reported as such rather than as a
 * date, since it is the one case where the answer is Syrax's rather than the document's.
 *
 * The filename is read before the body so that a corpus of hundreds is not opened to answer a
 * question about one day: a file whose own day ended before the window began is skipped unread.
 */
async function postedAt(path: string, since: Date): Promise<{ at: Date; dated: Dated } | null> {
  const day = dayInName.exec(basename(path))?.[1];
  if (day !== undefined && endOfDay(day) < since) return null;

  const created = await createdAt(path);
  if (created !== null)
    return created >= since ? { at: created, dated: "its own Created line" } : null;
  if (day !== undefined) return { at: startOfDay(day), dated: "the day in its filename" };

  const written = await modifiedAt(path);
  if (written === null || written < since) return null;
  return { at: written, dated: "when the sync wrote it" };
}

async function createdAt(path: string): Promise<Date | null> {
  const created = createdInBody.exec(await head(path))?.[1];
  if (created === undefined) return null;
  const at = new Date(created);
  return Number.isNaN(+at) ? null : at;
}

/**
 * A day rather than a moment, so a filename-dated entry is placed at the start of its day and is
 * still inside a window that opened during it. A brief that repeats an entry once is cheaper than
 * one that drops it: the day is all the filename knows.
 *
 * **Read as UTC, because that is how it was written.** `ntulearn` names a file from the UTC date of
 * the announcement's own creation (`src/sync/expected.mjs`), so reading it on this machine's clock
 * would put a day's end eight hours early here — and an announcement posted after that would be
 * skipped unread as older than a window it is actually inside.
 */
function startOfDay(day: string): Date {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date));
}

function endOfDay(day: string): Date {
  return new Date(+startOfDay(day) + 86_399_999);
}

/** The title as the Owner reads it: without the day the entry already carries, and without `.md`. */
function titleOf(file: string): string {
  const name = withoutExtension(file);
  return dayInName.exec(name)?.[2] ?? name;
}

async function head(path: string): Promise<string> {
  try {
    return (await readFile(path, "utf8")).slice(0, headerBytes);
  } catch {
    return "";
  }
}

/**
 * The walk follows no symlink, which is the rule the indexer keeps for the same corpus (ADR-0004):
 * a link inside the modules root is a way out of it, and a root that can be left is not a bound.
 */
async function* announcementFolders(root: string, depth: number): AsyncGenerator<string> {
  if (depth === 0) return;
  for (const entry of await directories(root)) {
    if (entry.startsWith(".")) continue;
    const path = join(root, entry);
    if (entry === "Announcements") {
      yield path;
      continue;
    }
    yield* announcementFolders(path, depth - 1);
  }
}

/** A module code where the path holds one, and the folder that holds the course where it does not. */
const moduleCode = /^[A-Z]{2}\d{4}[A-Z]?$/;

function moduleOf(modulesRoot: string, folder: string): string {
  const segments = relative(modulesRoot, folder).split(sep);
  const code = segments.find((segment) => moduleCode.test(segment));
  return code ?? segments.at(-2) ?? basename(folder);
}

function withoutExtension(file: string): string {
  return file.replace(/\.[^.]+$/, "");
}

/** Files that are files themselves: a directory or a link inside `Announcements/` is not an entry. */
async function files(path: string): Promise<string[]> {
  return await named(path, (entry) => entry.isFile());
}

/** Directories that are directories themselves, rather than links to somewhere that is one. */
async function directories(path: string): Promise<string[]> {
  return await named(path, (entry) => entry.isDirectory());
}

async function named(path: string, wanted: (entry: Dirent) => boolean): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => wanted(entry))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** `lstat` rather than `stat`, so a link to a file outside the root is not read as one inside it. */
async function modifiedAt(path: string): Promise<Date | null> {
  try {
    const stats = await lstat(path);
    return stats.isFile() ? stats.mtime : null;
  } catch {
    return null;
  }
}

/** What a sync did, in the two numbers a chat can say out loud plus whatever it refused. */
export type SyncRun = {
  ok: boolean;
  said: string;
  courses: number;
  refused: { key?: string; reason?: string }[];
};

/**
 * The sync itself: minutes of downloading, spending the saved session and writing to disk. It is
 * run to completion here and **not inside a turn** — the desk starts it and says so, then posts
 * what it did into the Academic chat, because a tool call that waited for it would outlive the
 * runtime's whole-turn ceiling and leave the Owner with a timeout instead of a verdict.
 */
export async function runSync(products: Products): Promise<SyncRun> {
  const ran = await products.ntulearn(["sync", "all"], writeTimeoutMs);
  const report = (ran.report ?? {}) as { courses?: unknown[]; refused?: unknown[] };
  return {
    ok: ran.ok,
    said: ran.said,
    courses: Array.isArray(report.courses) ? report.courses.length : 0,
    refused: Array.isArray(report.refused) ? (report.refused as SyncRun["refused"]) : [],
  };
}
