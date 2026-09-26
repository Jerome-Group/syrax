import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { describe, it, type TestContext } from "node:test";
import { readDeployment } from "../src/adapter/deployment.ts";
import { landConfigWrite, runtimeEntrypoint } from "../src/adapter/runtime-command.ts";
import { standInRuntime, temporaryMachine } from "./machine.ts";

function slowMachine(
  t: TestContext,
  options: { busy?: boolean; wedged?: boolean; callMs?: number },
) {
  const { deployment: input } = temporaryMachine();
  const deployment = readDeployment(input);
  const log = standInRuntime(deployment.runtimeRoot, options);
  if (options.busy) {
    const entrypoint = runtimeEntrypoint(deployment.runtimeRoot);
    writeFileSync(
      entrypoint,
      readFileSync(entrypoint, "utf8").replace("safe: true", "safe: false"),
    );
  }
  const commands = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
  // A completed CLI call consumes elapsed budget; the test never waits for it.
  t.mock.method(performance, "now", () => commands().length * (options.callMs ?? 31_000));
  const schedule = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (callback: () => void) => schedule(callback, 0));
  return { deployment, commands };
}

describe("configuration landing deadlines", () => {
  it("counts slow preflight calls toward the quiet deadline", async (t) => {
    const { deployment, commands } = slowMachine(t, { busy: true });
    const landed = await landConfigWrite(deployment);
    const ran = commands();
    assert.equal(ran.filter((command) => command.includes("gateway.restart.preflight")).length, 2);
    assert.ok(ran.some((command) => command.includes("gateway restart --safe")));
    assert.equal(landed.landed, false);
    assert.match(landed.said, /new connected telegram channel was not confirmed/);
  });

  it("counts slow status calls toward the connection deadline", async (t) => {
    const { deployment, commands } = slowMachine(t, { wedged: true });
    const landed = await landConfigWrite(deployment);
    const ran = commands();
    assert.equal(ran.filter((command) => command.includes("channels.status")).length, 2);
    assert.equal(ran.filter((command) => command.includes("channels.start")).length, 2);
    assert.ok(ran.some((command) => command.includes("gateway restart --safe")));
    assert.equal(landed.landed, false);
    assert.match(landed.said, /new connected telegram channel was not confirmed/);
  });

  it("retries a start once the status call itself crosses the halfway threshold", async (t) => {
    const { deployment, commands } = slowMachine(t, { wedged: true, callMs: 16_000 });
    const landed = await landConfigWrite(deployment);
    const ran = commands();
    assert.equal(ran.filter((command) => command.includes("channels.status")).length, 2);
    assert.equal(ran.filter((command) => command.includes("channels.start")).length, 3);
    assert.ok(ran.some((command) => command.includes("gateway restart --safe")));
    assert.equal(landed.landed, true);
  });
});
