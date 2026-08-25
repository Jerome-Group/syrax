/**
 * The NTULearn half of the pair: the watchdog's verdict, the announcements a sync has already
 * written to disk, and the sync itself — the one write of the two that spends a saved SSO session.
 *
 * Both reads are of files the product wrote for a reader (`latest.json` is described in its own
 * README as the stable input for a delivery channel). Nothing here re-derives a verdict from a run
 * log or re-walks NTULearn: a second opinion about a run that already happened is a number no run
 * produced.
 */

import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { Products, writeTimeoutMs } from "./products.ts";

export type SyncVerdict = {
  verdict: "green" | "yellow" | "red" | "unknown";
  message: string;
  /** When the run finished, or null where no watchdog has ever written a digest here. */
  at: string | null;
  /**
   * The one failure only the Owner can clear. `npm run login` opens an interactive SSO/MFA window,
   * which cannot be driven from a chat — so the chat's job is to say it is needed and stop there.
   */
  needsLogin: boolean;
};

/** The digest ntulearn's watchdog writes after its ~05:00 run. */
export async function syncVerdict(products: Products): Promise<SyncVerdict> {
  const path = join(products.paths.ntulearnState, "latest.json");
  let digest: { verdict?: unknown; message?: unknown; timestamp?: unknown };
  try {
    digest = JSON.parse(await readFile(path, "utf8")) as typeof digest;
  } catch {
    return {
      verdict: "unknown",
      message: "no watchdog run has been written to read.",
      at: null,
      needsLogin: false,
    };
  }
  const verdict = isVerdict(digest.verdict) ? digest.verdict : "unknown";
  return {
    verdict,
    message: typeof digest.message === "string" ? digest.message : "",
    at: typeof digest.timestamp === "string" ? digest.timestamp : null,
    needsLogin: verdict === "red" || verdict === "yellow",
  };
}

function isVerdict(value: unknown): value is SyncVerdict["verdict"] {
  return value === "green" || value === "yellow" || value === "red";
}

export const reLoginLine =
  "The saved NTULearn session may have lapsed: `npm run login` in the ntulearn checkout is the only thing that clears this, and only you can do it.";

export type Announcement = { module: string; title: string; at: string };

/** How far below the modules root an `Announcements/` folder is looked for: semester, module, importer root. */
const mostDepth = 6;

/**
 * What arrived, read off the disk a sync already wrote to rather than by asking NTULearn again. The
 * modules root is the one configuration binds to the Academic chat's search scope, so *what Syrax
 * reads* and *what Syrax searches* cannot drift apart into two roots.
 */
export async function announcementsSince(
  modulesRoot: string,
  since: Date,
): Promise<Announcement[]> {
  const arrived: Announcement[] = [];
  for await (const folder of announcementFolders(modulesRoot, mostDepth)) {
    for (const file of await entries(folder)) {
      if (file.startsWith(".")) continue;
      const path = join(folder, file);
      const when = await modifiedAt(path);
      if (when === null || when < since) continue;
      arrived.push({
        module: moduleOf(modulesRoot, folder),
        title: withoutExtension(file),
        at: when.toISOString(),
      });
    }
  }
  return arrived.sort((one, other) => one.at.localeCompare(other.at));
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

async function entries(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

/** Directories that are directories themselves, rather than links to somewhere that is one. */
async function directories(path: string): Promise<string[]> {
  try {
    const found = await readdir(path, { withFileTypes: true });
    return found.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
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
