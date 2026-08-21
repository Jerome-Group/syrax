/**
 * ADR-0014's two stated settings and the fixed basename they depend on. The basename decides the
 * behaviour: a `<name>-YYYY-MM-DD.log` shape switches the runtime into rolling mode, where it picks
 * the date itself and prunes every same-prefix file older than a day — rotated archives included.
 */

import { join } from "node:path";

/** Fixed, and depended upon: the lane monitor reads this file keyed on inode and size (ADR-0012). */
export const runtimeLogBasename = "openclaw.log";

/** 25 MB, and five archives beside it. The default of 100 MB makes retention time-unbounded. */
const maxFileBytes = 26214400;

export function runtimeLogPath(logsDir: string): string {
  return join(logsDir, runtimeLogBasename);
}

export function loggingBlock(logsDir: string) {
  return {
    file: runtimeLogPath(logsDir),
    maxFileBytes,
    // The runtime's own default, stated because ADR-0010 moved credentials to file-backed refs and
    // a log line is the one place a resolved key could still surface.
    redactSensitive: "tools",
  };
}
