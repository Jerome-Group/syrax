/**
 * The pinned runtime run as a command rather than as the gateway, and the one job Syrax needs of it:
 * making a write to the generated configuration reach the next turn.
 *
 * A config write reaches a running gateway in two moves, and only the second is one the Owner would
 * notice (ADR-0021). A chain lives under `agents`, which is applied when written and landed only
 * when the turn path is rebuilt — so a write is an actuator only when it is paired with a lander,
 * and `gateway restart --safe` is the lander.
 *
 * **The restart is the mechanism rather than the fallback, and that is now measured rather than
 * assumed** (`docs/research/landing-an-agents-write.md`). `config.apply`, the candidate ADR-0021
 * named, is a writer: it wrote the file, returned `ok`, and six turns went on using the old chain.
 * A `channels.stop` + `channels.start` pair *is* a lander and keeps the sessions a restart spends —
 * but issued from inside a turn, which is how a stand down is always asked for, the stop times out
 * mid-teardown, the start that follows it does nothing, and the channel is left down with the
 * gateway alive. The restart is the only one of the three that knows a turn is in flight: it defers
 * until the work drains, and the in-flight reply arrives at the same moment it would have anyway.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import type { Deployment } from "./deployment.ts";

export function runtimeEntrypoint(runtimeRoot: string): string {
  return join(runtimeRoot, "node_modules", "openclaw", "openclaw.mjs");
}

/** What the lander did, in the two facts a caller can act on. */
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
          ? { landed: true, said: "the gateway restarted safely, so the sessions are gone" }
          : { landed: false, said: `the safe restart exited ${code}: ${said.trim() || "nothing"}` },
      ),
    );
  });
}
