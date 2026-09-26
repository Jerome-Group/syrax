/**
 * The pinned runtime run as a command rather than as the gateway, and the one job Syrax needs of it:
 * making a write to the generated configuration reach the next turn.
 *
 * ADR-0021's OpenClaw 2026.6.34 measurement found that an agents write and `config.apply`
 * did not rebuild the turn path. Reloading the channel landed it, but a reload during an active
 * turn could strand the channel during teardown. That historical result is why this lander waits
 * for quiet, reloads, and verifies the channel connection; it does not assume every runtime version
 * has the same automatic reload behavior.
 *
 * When a channel reload cannot be verified, a safe restart lets the runtime defer until work
 * drains. Its command may acknowledge the request before the channel reconnects, so success needs
 * a new connected channel lifecycle rather than just a zero command exit.
 *
 * **It opens with an admin call, and the order is not cosmetic.** The CLI mints this machine's
 * pairing from the scopes of the *first* method it is ever asked for, and an upgrade afterwards
 * waits for an approval nobody is there to give — so a read-scoped call first leaves every admin
 * call, the safe restart included, refused with *scope upgrade pending approval*. Starting a channel
 * that is already running is the harmless admin call that settles it.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
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
  const requestedAt = Date.now();
  const ran = await runtimeCommand(deployment, ["gateway", "restart", "--safe"]);
  if (ran.code !== 0) {
    return { landed: false, said: `the safe restart exited ${ran.code}: ${ran.said}` };
  }
  const began = performance.now();
  const params = JSON.stringify({ channel: channelName });
  for (const _ of every(connectedWithinMs)) {
    const status = await gatewayCall(deployment, "channels.status", params);
    const account = channelAccount(status.body);
    if (performance.now() - began >= connectedWithinMs) break;
    if (
      status.ok &&
      account?.running === true &&
      account.connected === true &&
      typeof account.lastStartAt === "number" &&
      Number.isSafeInteger(account.lastStartAt) &&
      account.lastStartAt > requestedAt &&
      account.lastStartAt <= Date.now()
    ) {
      return {
        landed: true,
        said: `the safe restart was requested, and the ${channelName} channel reconnected afterward`,
      };
    }
    await waitOne();
  }
  return {
    landed: false,
    said: `the safe restart was requested, but a new connected ${channelName} channel was not confirmed`,
  };
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
  const began = performance.now();
  let started = false;
  for (const _ of every(connectedWithinMs)) {
    const status = await gatewayCall(deployment, "channels.status", params);
    const account = channelAccount(status.body);
    if (account?.running === true && account.connected === true) return true;
    // One more start, once: the first can land while the account is still on its way down.
    const waited = performance.now() - began;
    if (!started && waited >= connectedWithinMs / 2 && waited < connectedWithinMs) {
      started = true;
      await gatewayCall(deployment, "channels.start", params);
    }
    await waitOne();
  }
  return false;
}

function channelAccount(
  body: unknown,
): { running?: unknown; connected?: unknown; lastStartAt?: unknown } | undefined {
  const accounts = (body as { channelAccounts?: Record<string, unknown> } | null)
    ?.channelAccounts?.[channelName];
  return Array.isArray(accounts) ? accounts[0] : undefined;
}

function* every(withinMs: number): Generator<number> {
  const started = performance.now();
  for (let waited = 0; waited < withinMs; waited = performance.now() - started) yield waited;
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
