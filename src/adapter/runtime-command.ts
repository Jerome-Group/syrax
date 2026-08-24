/**
 * The pinned runtime run as a command rather than as the gateway, and the one job Syrax needs of it:
 * making a write to the generated configuration reach the next turn.
 *
 * A chain lives under `agents`, which is applied when written and landed only when the turn path is
 * rebuilt (ADR-0021), so a write is an actuator only when it is paired with a lander. Which lander,
 * and when, is measured in `docs/research/landing-an-agents-write.md` rather than chosen:
 *
 * - **`config.apply` is not one.** It writes the file, returns `ok`, and no turn changes.
 * - **Reloading the channel is**, and it keeps the sessions a restart spends. But it must not be
 *   issued while a turn is in flight: the stop times out mid-teardown, the start that follows does
 *   nothing, and the channel is left down with the gateway alive and nothing listening.
 * - **`gateway restart --safe` always ends with a live channel**, deferring until the work drains,
 *   and it costs the sessions.
 *
 * So the sequence here waits for the gateway to say it is quiet, reloads the channel, and **checks
 * that the channel came back** rather than believing the start that says it did. Every branch that
 * cannot get there ends at the restart: a stand down that leaves the Owner's chat deaf is worse
 * than one that costs them a session.
 *
 * **It opens with an admin call, and the order is not cosmetic.** The CLI mints this machine's
 * pairing from the scopes of the *first* method it is ever asked for, and an upgrade afterwards
 * waits for an approval nobody is there to give — so a read-scoped call first leaves every admin
 * call, the safe restart included, refused with *scope upgrade pending approval*. Starting a channel
 * that is already running is the harmless admin call that settles it.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import type { Deployment } from "./deployment.ts";
import { channelName } from "./telegram-channel.ts";

export function runtimeEntrypoint(runtimeRoot: string): string {
  return join(runtimeRoot, "node_modules", "openclaw", "openclaw.mjs");
}

/** What the lander did, in the two facts a caller can act on. */
export type Landed = { landed: boolean; said: string };

/** Long enough for a slow turn to finish, short enough that a stuck one is not waited on for ever. */
const quietWithinMs = 60_000;

/** The channel came back six seconds after the start in the measurement; this is room around that. */
const connectedWithinMs = 30_000;

const pollEveryMs = 1000;

/** A loaded `channels.stop` outlives the CLI's ten-second default, and exits 1 while it succeeds. */
const callTimeoutMs = 30_000;

export async function landConfigWrite(deployment: Deployment): Promise<Landed> {
  const scoped = await gatewayCall(
    deployment,
    "channels.start",
    JSON.stringify({ channel: channelName }),
  );
  if (!scoped.ok) {
    const restarted = await landBySafeRestart(deployment);
    return restarted.landed
      ? { landed: true, said: `${restarted.said}, since the gateway would not take a channel call` }
      : restarted;
  }

  const quiet = await untilQuiet(deployment);
  if (quiet !== "quiet") {
    const restarted = await landBySafeRestart(deployment);
    return restarted.landed
      ? { landed: true, said: `${restarted.said}, since ${whyNotQuiet(quiet)}` }
      : restarted;
  }

  const reloaded = await reloadTheChannel(deployment);
  if (reloaded.landed) return reloaded;
  const restarted = await landBySafeRestart(deployment);
  return restarted.landed
    ? { landed: true, said: `${restarted.said}, since ${reloaded.said}` }
    : restarted;
}

/**
 * Never throws. A restart that cannot be spawned leaves a written stand down unlanded, and the
 * Owner is told that in the same breath as the change itself — which is more use than an exception
 * that loses the write that already happened.
 */
export async function landBySafeRestart(deployment: Deployment): Promise<Landed> {
  const ran = await runtimeCommand(deployment, ["gateway", "restart", "--safe"]);
  return ran.code === 0
    ? { landed: true, said: "the gateway restarted safely, so the sessions are gone" }
    : { landed: false, said: `the safe restart exited ${ran.code}: ${ran.said}` };
}

/**
 * Stop the channel and start it again: the same two calls the runtime's own hot reload makes. The
 * start's own answer is not evidence — it reports `started` against an account that is still
 * tearing down — so the channel is asked whether it is up, and started again if it is not.
 */
async function reloadTheChannel(deployment: Deployment): Promise<Landed> {
  const params = JSON.stringify({ channel: channelName });
  const stopped = await gatewayCall(deployment, "channels.stop", params);
  if (!stopped.ok) return { landed: false, said: `channels.stop said: ${stopped.said}` };
  const started = await gatewayCall(deployment, "channels.start", params);
  if (!started.ok) return { landed: false, said: `channels.start said: ${started.said}` };

  if (await untilConnected(deployment)) {
    return {
      landed: true,
      said: `the ${channelName} channel was reloaded, and the sessions stand`,
    };
  }
  return { landed: false, said: `the ${channelName} channel did not come back up` };
}

/** Polls until the gateway says a restart would be safe, which is the same thing as *no turn now*. */
async function untilQuiet(deployment: Deployment): Promise<"quiet" | "busy" | "unreadable"> {
  let answer: "quiet" | "busy" | "unreadable" = "unreadable";
  for (const _ of every(quietWithinMs)) {
    const preflight = await gatewayCall(deployment, "gateway.restart.preflight", "{}");
    const safe = (preflight.body as { safe?: unknown } | null)?.safe;
    if (!preflight.ok || typeof safe !== "boolean") return "unreadable";
    if (safe) return "quiet";
    answer = "busy";
    await waitOne();
  }
  return answer;
}

/** The channel's own account, which is the only thing that knows whether anything is listening. */
async function untilConnected(deployment: Deployment): Promise<boolean> {
  const params = JSON.stringify({ channel: channelName });
  let started = false;
  for (const waited of every(connectedWithinMs)) {
    const status = await gatewayCall(deployment, "channels.status", params);
    const account = (
      status.body as {
        channelAccounts?: Record<string, { running?: boolean; connected?: boolean }[]>;
      } | null
    )?.channelAccounts?.[channelName]?.[0];
    if (account?.running === true && account.connected === true) return true;
    // One more start, once: the first can land while the account is still on its way down.
    if (!started && waited >= connectedWithinMs / 2) {
      started = true;
      await gatewayCall(deployment, "channels.start", params);
    }
    await waitOne();
  }
  return false;
}

function* every(withinMs: number): Generator<number> {
  for (let waited = 0; waited < withinMs; waited += pollEveryMs) yield waited;
}

function waitOne(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, pollEveryMs));
}

function whyNotQuiet(quiet: "busy" | "unreadable"): string {
  return quiet === "busy"
    ? "the gateway was still working when the wait ran out"
    : "the gateway would not say whether anything was in flight";
}

/** One gateway method, and whatever JSON it answered with. */
async function gatewayCall(
  deployment: Deployment,
  method: string,
  params: string,
): Promise<{ ok: boolean; body: unknown; said: string }> {
  const ran = await runtimeCommand(deployment, [
    "gateway",
    "call",
    method,
    "--params",
    params,
    "--json",
    "--timeout",
    String(callTimeoutMs),
  ]);
  if (ran.code !== 0) return { ok: false, body: null, said: `it exited ${ran.code}: ${ran.said}` };
  try {
    return { ok: true, body: JSON.parse(ran.out) as unknown, said: "" };
  } catch {
    return { ok: false, body: null, said: "it answered something that is not JSON" };
  }
}

/**
 * The gateway's own two variables and nothing else of this unit's: a command must be pointed at the
 * deployment it is acting on rather than at whatever this process inherited.
 */
function runtimeCommand(
  deployment: Deployment,
  argv: string[],
): Promise<{ code: number | null; out: string; said: string }> {
  return new Promise((resolve) => {
    const ran = spawn(process.execPath, [runtimeEntrypoint(deployment.runtimeRoot), ...argv], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        OPENCLAW_CONFIG_PATH: deployment.configPath,
        OPENCLAW_STATE_DIR: deployment.stateDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let said = "";
    ran.stdout?.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
    ran.stderr?.on("data", (chunk: Buffer) => (said += chunk.toString("utf8")));
    ran.on("error", (error) => resolve({ code: -1, out, said: error.message }));
    ran.on("close", (code) => resolve({ code, out, said: said.trim() || "nothing" }));
  });
}
