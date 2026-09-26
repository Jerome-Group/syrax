import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { describe, it, type TestContext } from "node:test";
import { readDeployment } from "../src/adapter/deployment.ts";
import { landBySafeRestart, runtimeEntrypoint } from "../src/adapter/runtime-command.ts";
import { temporaryMachine } from "./machine.ts";

function restartMachine(
  context: TestContext,
  statuses: unknown[],
  options: { fail?: boolean; callMs?: number } = {},
) {
  const deployment = readDeployment(temporaryMachine().deployment);
  const entrypoint = runtimeEntrypoint(deployment.runtimeRoot);
  const log = `${entrypoint}.commands`;
  const requestedAt = 1_800_000_000_000;
  const commands = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
  context.mock.method(Date, "now", () => requestedAt + commands().length);
  context.mock.method(performance, "now", () => commands().length * (options.callMs ?? 10_000));
  const schedule = globalThis.setTimeout;
  context.mock.method(globalThis, "setTimeout", (callback: () => void) => schedule(callback, 0));
  mkdirSync(dirname(entrypoint), { recursive: true });
  writeFileSync(
    entrypoint,
    `import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, args.join(" ") + "\\n");
if (args[1] === "restart") process.exit(${options.fail ? "1" : "0"});
const count = readFileSync(${JSON.stringify(log)}, "utf8").trim().split("\\n").length - 2;
const statuses = ${JSON.stringify(statuses)};
process.stdout.write(JSON.stringify(statuses[Math.min(count, statuses.length - 1)]));
`,
  );
  return { deployment, commands, requestedAt };
}

function ready(lastStartAt: unknown, connected: unknown = true) {
  return { channelAccounts: { telegram: [{ running: true, connected, lastStartAt }] } };
}

describe("safe restart completion", () => {
  it("waits past the still-connected old lifecycle until the replacement connects", async (context) => {
    const machine = restartMachine(context, [ready(1), ready(1_800_000_000_001)]);
    const result = await landBySafeRestart(machine.deployment);
    assert.equal(result.landed, true);
    assert.match(result.said, /channel reconnected afterward/);
    assert.doesNotMatch(result.said, /sessions.*gone/);
    assert.equal(
      machine.commands().filter((command) => command.includes("channels.status")).length,
      2,
    );
    assert.equal(
      machine.commands().some((command) => command.includes("channels.start")),
      false,
    );
  });

  for (const [name, status] of [
    ["old connected lifecycle", ready(1)],
    ["missing timestamp", ready(null)],
    ["future timestamp", ready(1_800_000_001_000)],
    ["fractional timestamp", ready(1_800_000_000_001.5)],
    ["malformed status", null],
    ["string timestamp", ready("1800000000001")],
    ["disconnected replacement", ready(1_800_000_000_001, false)],
    [
      "malformed account list",
      {
        channelAccounts: {
          telegram: { 0: { running: true, connected: true, lastStartAt: 1_800_000_000_001 } },
        },
      },
    ],
  ] as const) {
    it(`does not accept a ${name}`, async (context) => {
      const machine = restartMachine(context, [status]);
      const result = await landBySafeRestart(machine.deployment);
      assert.equal(result.landed, false);
      assert.match(result.said, /was not confirmed/);
      assert.equal(machine.commands().length, 4);
    });
  }

  it("does not accept a connected lifecycle reported after the elapsed deadline", async (context) => {
    const machine = restartMachine(context, [ready(1_800_000_000_001)], { callMs: 31_000 });
    assert.equal((await landBySafeRestart(machine.deployment)).landed, false);
    assert.equal(machine.commands().length, 2);
  });

  it("reports command failure without polling", async (context) => {
    const machine = restartMachine(context, [ready(1_800_000_000_001)], { fail: true });
    const result = await landBySafeRestart(machine.deployment);
    assert.equal(result.landed, false);
    assert.match(result.said, /exited 1/);
    assert.equal(machine.commands().length, 1);
  });
});
