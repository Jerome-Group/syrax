/**
 * The runtime's own fallback decisions, read rather than classified (ADR-0012). The pinned runtime
 * emits a `model_fallback_decision` warn carrying which rung was asked for, which one answered, and
 * why the first did not — so the classification is already done by the component best placed to do
 * it, and this is a reader.
 *
 * **The log speaks only once something has gone wrong.** A chain whose first rung answers every turn
 * writes nothing at all, so silence here is not evidence of health — it is evidence of nothing, and
 * the rungs beneath the serving one are invisible until the one above them fails.
 *
 * The window is the load-bearing part. The runtime prunes its own log and rotates it, so a reader
 * poked on a schedule sits near the edge of that retention: the cursor is keyed on inode **and**
 * size, and a log that was replaced, truncated or never read before is reported as a gap rather
 * than as a quiet hour.
 */

import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/** One decision, in the fields a reader can act on. The provider's words are passed through. */
export type Decision = {
  at: string;
  decision: string;
  /** The rung the chain asked for, and the one that answered, each as `provider/model`. */
  requested: string;
  candidate: string;
  reason: string | null;
  status: number | null;
  /** What the provider said, verbatim: a model that is gone and one that has stopped being free
   * wear the same code, and only these words tell them apart. */
  said: string | null;
  /**
   * The same words at the runtime's longer cap. `said` is the preview it truncates to 200
   * characters from the head, and a refusal naming its numbers late — a long model slug, a long
   * organisation id — loses them there with no sign that anything was cut. Anything reading a
   * figure out of the words reads this and falls back to `said`; anything showing them shows
   * `said`, which is the length the runtime chose for a message a person reads.
   */
  saidInFull: string | null;
};

/**
 * Where the last read stopped, and what says it is still the same file underneath.
 *
 * The inode and the size are ADR-0012's two keys and they are **not enough**: a filesystem is free
 * to hand a replacement file the inode the deleted one had, and a log that has only just started
 * again is not shorter than a small offset into the old one. So the cursor also carries a print of
 * the bytes immediately before the offset, and a read that cannot find them again starts over and
 * says it did.
 */
export type Cursor = {
  inode: number;
  size: number;
  offset: number;
  /** A hash of the bytes just before `offset`, which is what makes this the same file's offset. */
  print: string;
  readAt: string;
};

export type Reading = {
  decisions: Decision[];
  cursor: Cursor;
  /** What this read actually covered. `unknown` is the gap it can prove it missed. */
  window: { from: string | null; to: string; unknown: string | null };
};

export function readDecisions(logPath: string, previous: Cursor | null, now: Date): Reading {
  const to = now.toISOString();
  const from = previous?.readAt ?? null;
  let handle;
  try {
    handle = openSync(logPath, "r");
  } catch {
    return {
      decisions: [],
      cursor: previous ?? { inode: 0, size: 0, offset: 0, print: "", readAt: to },
      window: { from, to, unknown: "the runtime's log could not be opened" },
    };
  }

  try {
    const stat = fstatSync(handle);
    const start = startOf(previous, stat.ino, stat.size, printAt(handle, previous?.offset ?? 0));
    const decisions: Decision[] = [];
    let offset = start.offset;
    for (const line of linesBetween(handle, start.offset, stat.size)) {
      decisions.push(...asDecision(line.text));
      offset = line.end;
    }
    return {
      decisions,
      cursor: {
        inode: stat.ino,
        size: stat.size,
        offset,
        print: printAt(handle, offset),
        readAt: to,
      },
      window: { from, to, unknown: start.unknown },
    };
  } finally {
    closeSync(handle);
  }
}

function startOf(
  previous: Cursor | null,
  inode: number,
  size: number,
  print: string,
): { offset: number; unknown: string | null } {
  if (previous === null) {
    return {
      offset: 0,
      unknown: "the log had never been read, so anything already pruned is outside this window",
    };
  }
  if (previous.inode !== inode) {
    return {
      offset: 0,
      unknown: "the log was replaced since the last read, and what it held is gone",
    };
  }
  if (size < previous.offset) {
    return {
      offset: 0,
      unknown: "the log is shorter than the last read left it, so it was rewritten",
    };
  }
  if (print !== previous.print) {
    return {
      offset: 0,
      unknown: "the log no longer holds what the last read left behind it",
    };
  }
  return { offset: previous.offset, unknown: null };
}

/**
 * The bytes immediately before an offset, hashed. A short window is enough to tell one log from
 * another at the same offset, and hashing keeps a chat line out of this unit's own state file.
 */
function printAt(handle: number, offset: number): string {
  if (offset <= 0) return "";
  const wanted = Math.min(256, offset);
  try {
    const buffer = Buffer.alloc(wanted);
    const read = readSync(handle, buffer, 0, wanted, offset - wanted);
    return createHash("sha256").update(buffer.subarray(0, read)).digest("hex").slice(0, 16);
  } catch {
    return "";
  }
}

/** Whole lines only: a read that lands mid-line leaves the rest of it for the next one. */
function* linesBetween(
  handle: number,
  from: number,
  to: number,
): Generator<{ text: string; end: number }> {
  const chunkBytes = 64 * 1024;
  const parts: Buffer[] = [];
  let position = from;
  while (position < to) {
    const buffer = Buffer.alloc(Math.min(chunkBytes, to - position));
    const read = readSync(handle, buffer, 0, buffer.length, position);
    if (read === 0) break;
    let start = 0;
    for (
      let end = buffer.indexOf(0x0a);
      end >= 0 && end < read;
      end = buffer.indexOf(0x0a, start)
    ) {
      const part = buffer.subarray(start, end);
      const text =
        parts.length === 0
          ? part.toString("utf8")
          : Buffer.concat([...parts, part]).toString("utf8");
      parts.length = 0;
      yield { text, end: position + end + 1 };
      start = end + 1;
    }
    if (start < read) parts.push(buffer.subarray(start, read));
    position += read;
  }
}

/**
 * The structured record rides one of the line's numbered argument keys rather than a named field,
 * so it is found by its own `event` rather than by where this version of the logger put it.
 */
function asDecision(line: string): Decision[] {
  if (!line.includes("model_fallback_decision")) return [];
  let held: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null) return [];
    held = parsed as Record<string, unknown>;
  } catch {
    return [];
  }
  const record = Object.values(held).find(
    (value): value is Record<string, unknown> =>
      typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>).event === "model_fallback_decision",
  );
  if (record === undefined) return [];
  return [
    {
      at: typeof held.time === "string" ? held.time : "",
      decision: String(record.decision ?? ""),
      requested: `${String(record.requestedProvider)}/${String(record.requestedModel)}`,
      candidate: `${String(record.candidateProvider)}/${String(record.candidateModel)}`,
      reason: typeof record.reason === "string" ? record.reason : null,
      status: typeof record.status === "number" ? record.status : null,
      said: firstString(record.providerErrorMessagePreview, record.errorPreview),
      saidInFull: firstString(record.errorPreview, record.providerErrorMessagePreview),
    },
  ];
}

function firstString(...values: unknown[]): string | null {
  return (values.find((value) => typeof value === "string") as string | undefined) ?? null;
}
