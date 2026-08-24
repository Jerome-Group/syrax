/**
 * The pinned runtime run as a command rather than as the gateway: one entrypoint, and the one
 * command Syrax itself issues.
 *
 * A configuration write reaches the running gateway in two moves, and only the second is one the
 * Owner would notice (ADR-0021). `channels` lands itself; an `agents` write — which is what a stand
 * down is — waits for a channel reload that may never come, so the write is paired with the
 * runtime's own safe restart. `--safe` preflights the work in flight and restarts once it drains.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import type { Deployment } from "./deployment.ts";

export function runtimeEntrypoint(runtimeRoot: string): string {
  return join(runtimeRoot, "node_modules", "openclaw", "openclaw.mjs");
}

/** What the restart did, in the two facts a caller can act on. */
export type Landed = { landed: boolean; said: string };

/**
 * Never throws. A restart that cannot be spawned leaves a written stand down unlanded, and the
 * Owner is told that in the same breath as the stand down itself — which is more use than an
 * exception that loses the write that already happened.
 */
export function landConfigWrite(deployment: Deployment): Promise<Landed> {
  return new Promise((resolve) => {
    const restart = spawn(
      process.execPath,
      [runtimeEntrypoint(deployment.runtimeRoot), "gateway", "restart", "--safe"],
      {
        // The gateway's own two variables and nothing else of this unit's: a restart must be
        // pointed at the deployment being restarted rather than at whatever this process inherited.
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          OPENCLAW_CONFIG_PATH: deployment.configPath,
          OPENCLAW_STATE_DIR: deployment.stateDir,
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let said = "";
    restart.stderr?.on("data", (chunk: Buffer) => {
      said += chunk.toString("utf8");
    });
    restart.on("error", (error) => resolve({ landed: false, said: error.message }));
    restart.on("close", (code) =>
      resolve(
        code === 0
          ? { landed: true, said: "the gateway restarted safely" }
          : {
              landed: false,
              said: `the safe restart exited ${code}: ${said.trim() || "nothing said"}`,
            },
      ),
    );
  });
}
