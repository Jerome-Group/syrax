/**
 * The lane monitor at its two seams: the provider wire the hatch spends on, and the file its
 * counters land in. What is asserted throughout is what left the machine — a refusal that spends
 * nothing is a refusal the stub never hears about.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { buildRuntimeConfig } from "../src/adapter/build.ts";
import { readDeployment, type Deployment } from "../src/adapter/deployment.ts";
import {
  hatchTool,
  hatchToolName,
  mcpPath,
  monitorServerName,
  removeRungToolName,
  reportToolName,
  standDownToolName,
} from "../src/adapter/monitor-tools.ts";
import { hatchLane, rungId, silentProvider } from "../src/adapter/hatch-lane.ts";
import { frontLane } from "../src/adapter/front-lane.ts";
import { workerLane } from "../src/adapter/worker-lane.ts";
import { modelRef } from "../src/adapter/lane.ts";
import { DailyCounters, providerDay } from "../src/monitor/counters.ts";
import { LaneMonitor, serveLaneMonitor } from "../src/monitor/lane-monitor.ts";
import { mcpEndpoint } from "../src/monitor/mcp.ts";
import { ProviderStub } from "./stubs/openai-provider.ts";
import { temporaryMachine, writePrivateSecretsStore } from "./machine.ts";

const geminiKey = "a-gemini-key";

async function monitorOn(stub: ProviderStub): Promise<Deployment> {
  const { deployment } = temporaryMachine({
    providerBaseUrls: { "syrax-gemini": stub.baseUrl },
  });
  writePrivateSecretsStore(deployment.secretsStore, {
    providers: { gemini: { apiKey: geminiKey } },
  });
  return readDeployment(deployment);
}

/** The Owner's own words, which are the only thing that opens the hatch. */
const askedFor = "use the escape hatch for this one";

describe("the escape hatch", () => {
  it("refuses a call the Owner did not ask for, and nothing leaves the machine", async () => {
    const stub = await ProviderStub.start();
    after(() => stub.close());
    const monitor = new LaneMonitor(await monitorOn(stub));

    const answered = await monitor.hatch.reach({ question: "a hard one", askedFor: "  " });

    assert.equal(answered.reached, false);
    assert.match(answered.refused, /explicit ask/);
    assert.deepEqual(stub.requests, []);
  });

  it("spends one rung's allowance per call and states what is left", async () => {
    const stub = await ProviderStub.start({
      standingReply: { kind: "reply", text: "the considered answer" },
    });
    after(() => stub.close());
    const deployment = await monitorOn(stub);
    const monitor = new LaneMonitor(deployment);

    const answered = await monitor.hatch.reach({ question: "a hard one", askedFor });

    assert.equal(answered.reached, true);
    assert.equal(answered.rung, rungId(hatchLane.rungs[0]));
    assert.equal(answered.answer, "the considered answer");
    assert.deepEqual(
      answered.remaining.map((rung) => rung.remaining),
      hatchLane.rungs.map((rung, index) => rung.dailyRequests - (index === 0 ? 1 : 0)),
    );
    assert.equal(stub.askedModels.length, 1);
    assert.equal(stub.askedModels[0], hatchLane.rungs[0].modelId);
  });

  it("falls to the next rung once the one above it is spent, each counting for itself", async () => {
    const stub = await ProviderStub.start();
    after(() => stub.close());
    const deployment = await monitorOn(stub);
    const monitor = new LaneMonitor(deployment);
    const first = hatchLane.rungs[0];

    for (let call = 0; call < first.dailyRequests; call++) {
      await monitor.hatch.reach({ question: "a hard one", askedFor });
    }
    const answered = await monitor.hatch.reach({ question: "one more", askedFor });

    assert.equal(answered.reached, true);
    assert.equal(answered.rung, rungId(hatchLane.rungs[1]));
    assert.deepEqual(
      new Set(stub.askedModels),
      new Set([first.modelId, hatchLane.rungs[1].modelId]),
    );
  });

  it("refuses a spent day before any request leaves the machine", async () => {
    const stub = await ProviderStub.start();
    after(() => stub.close());
    const deployment = await monitorOn(stub);
    const monitor = new LaneMonitor(deployment);
    const wholeDay = hatchLane.rungs.reduce((total, rung) => total + rung.dailyRequests, 0);

    for (let call = 0; call < wholeDay; call++) {
      await monitor.hatch.reach({ question: "a hard one", askedFor });
    }
    const answered = await monitor.hatch.reach({ question: "one too many", askedFor });

    assert.equal(answered.reached, false);
    assert.match(answered.refused, /spent/);
    assert.equal(stub.askedModels.length, wholeDay, "a refusal reached the provider anyway.");
  });

  it("counts a refused call, since a refusal spends the allowance too", async () => {
    const stub = await ProviderStub.start();
    stub.script({
      kind: "rateLimited",
      code: "1302",
      message: "Rate limit reached for requests",
      retryAfterSeconds: 1,
    });
    after(() => stub.close());
    const monitor = new LaneMonitor(await monitorOn(stub));

    const answered = await monitor.hatch.reach({ question: "a hard one", askedFor });

    assert.equal(answered.reached, false);
    assert.equal(answered.remaining[0]!.spent, 1);
  });

  it("refuses a question with nothing in it rather than spending a rung on it", async () => {
    const stub = await ProviderStub.start();
    after(() => stub.close());
    const monitor = new LaneMonitor(await monitorOn(stub));

    const answered = await monitor.hatch.reach({ question: "   ", askedFor });

    assert.equal(answered.reached, false);
    assert.deepEqual(stub.requests, []);
    assert.equal(answered.remaining[0]!.spent, 0);
  });

  it("puts back a call the provider never served, so a bad backend cannot eat the day", async () => {
    const stub = await ProviderStub.start();
    stub.script({
      kind: "overloaded",
      message: "The model is overloaded. Please try again later.",
    });
    after(() => stub.close());
    const monitor = new LaneMonitor(await monitorOn(stub));

    const answered = await monitor.hatch.reach({ question: "a hard one", askedFor });

    assert.equal(answered.reached, false);
    assert.equal(answered.remaining[0]!.spent, 0, "a 503 was charged to the rung.");
    assert.equal(
      stub.askedModels.length,
      1,
      "the call never left, so there is nothing to put back.",
    );
  });

  it("puts back a call that never reached a provider at all", async () => {
    const { deployment } = temporaryMachine({
      // Nothing listens here, which is what a transport failure and a timeout both look like.
      providerBaseUrls: { "syrax-gemini": "http://127.0.0.1:1" },
    });
    writePrivateSecretsStore(deployment.secretsStore, {
      providers: { gemini: { apiKey: geminiKey } },
    });
    const monitor = new LaneMonitor(readDeployment(deployment));

    const answered = await monitor.hatch.reach({ question: "a hard one", askedFor });

    assert.equal(answered.reached, false);
    assert.match(answered.refused, /could not be reached/);
    assert.equal(answered.remaining[0]!.spent, 0);
  });

  it("keeps the spend where the provider answered about the request itself", async () => {
    const stub = await ProviderStub.start();
    stub.script({
      kind: "rateLimited",
      code: "1302",
      message: "Rate limit reached for requests",
      retryAfterSeconds: 1,
    });
    after(() => stub.close());
    const monitor = new LaneMonitor(await monitorOn(stub));

    const answered = await monitor.hatch.reach({ question: "a hard one", askedFor });

    assert.equal(
      answered.remaining[0]!.spent,
      1,
      "a 429 is the provider's own answer about the day.",
    );
  });

  it("keeps what refused a rung, in the provider's own words, past a restart", async () => {
    const stub = await ProviderStub.start();
    stub.script({
      kind: "overloaded",
      message: "The model is overloaded. Please try again later.",
    });
    after(() => stub.close());
    const deployment = await monitorOn(stub);

    await new LaneMonitor(deployment).hatch.reach({ question: "a hard one", askedFor });
    const refused = new LaneMonitor(deployment).counters.state()[0]!.refused!;

    assert.match(refused.said, /The model is overloaded/);
    assert.equal(refused.status, 503);
    assert.ok(Date.parse(refused.at) > 0, "a refusal with no time on it says nothing about when.");
  });

  it("refuses rather than reaching a provider when the store holds no key for it", async () => {
    const stub = await ProviderStub.start();
    after(() => stub.close());
    const { deployment } = temporaryMachine({
      providerBaseUrls: { "syrax-gemini": stub.baseUrl },
    });
    writePrivateSecretsStore(deployment.secretsStore, {});
    const monitor = new LaneMonitor(readDeployment(deployment));

    const answered = await monitor.hatch.reach({ question: "a hard one", askedFor });

    assert.equal(answered.reached, false);
    assert.deepEqual(stub.requests, []);
    assert.equal(answered.remaining[0]!.spent, 0);
  });
});

describe("the rationed lane's counters", () => {
  it("survives a restart of the unit, since a restart must not hand an allowance back", async () => {
    const stub = await ProviderStub.start();
    after(() => stub.close());
    const deployment = await monitorOn(stub);

    await new LaneMonitor(deployment).hatch.reach({ question: "a hard one", askedFor });
    const afterRestart = new LaneMonitor(deployment);

    assert.equal(afterRestart.counters.state()[0]!.spent, 1);
    assert.ok(existsSync(join(deployment.monitorState, "hatch-counters.json")));
  });

  it("holds one counter per rung of the ladder, and each carries its own allowance", () => {
    const { deployment } = temporaryMachine();
    const counters = new DailyCounters(readDeployment(deployment).monitorState);

    assert.deepEqual(
      counters.state().map((rung) => rung.rung),
      hatchLane.rungs.map(rungId),
    );
    for (const rung of counters.state()) assert.equal(rung.allowance, 20);
  });

  it("starts the allowance again when the provider's own day rolls", () => {
    const { deployment } = temporaryMachine();
    const counters = new DailyCounters(readDeployment(deployment).monitorState);
    const today = new Date("2026-08-24T20:00:00Z");
    const tomorrow = new Date("2026-08-25T20:00:00Z");

    counters.spend(hatchLane.rungs[0], today);

    assert.equal(counters.remaining(hatchLane.rungs[0], today), 19);
    assert.equal(counters.remaining(hatchLane.rungs[0], tomorrow), 20);
  });

  it("empties the counts on the day roll and keeps what refused a rung", () => {
    const { deployment } = temporaryMachine();
    const counters = new DailyCounters(readDeployment(deployment).monitorState);
    const today = new Date("2026-08-24T20:00:00Z");
    const tomorrow = new Date("2026-08-25T20:00:00Z");
    const rung = hatchLane.rungs[0];

    counters.spend(rung, today);
    counters.refuse(rung, { at: today.toISOString(), status: 503, said: "overloaded" }, today);

    assert.equal(counters.state(tomorrow)[0]!.spent, 0);
    assert.equal(counters.state(tomorrow)[0]!.refused?.said, "overloaded");
  });

  it("rolls the day where the provider resets it rather than where the machine is", () => {
    // 06:00 UTC is still the previous day in Pacific time, which is where the quota resets.
    assert.equal(providerDay(new Date("2026-08-25T06:00:00Z")), "2026-08-24");
    assert.equal(providerDay(new Date("2026-08-25T08:00:00Z")), "2026-08-25");
  });

  it("reads a counter file that has gone bad as a fresh day rather than refusing forever", () => {
    const { deployment } = temporaryMachine();
    const read = readDeployment(deployment);
    new LaneMonitor(read);
    const path = join(read.monitorState, "hatch-counters.json");
    writePrivateSecretsStore(path, "not a ledger");

    assert.equal(new DailyCounters(read.monitorState).state()[0]!.remaining, 20);
  });
});

describe("what each lane's headroom is read from", () => {
  it("counts the silent provider here, because it reports nothing to read", async () => {
    const stub = await ProviderStub.start();
    after(() => stub.close());
    const monitor = new LaneMonitor(await monitorOn(stub));

    await monitor.hatch.reach({ question: "a hard one", askedFor });
    const source = monitor.sources().find((one) => one.provider === silentProvider)!;

    assert.equal(source.headroom.kind, "counted");
    assert.equal(source.lastReadAt !== null, true);
  });

  it("takes a reporting provider's own numbers, and never a count kept here", () => {
    const { deployment } = temporaryMachine();
    const monitor = new LaneMonitor(readDeployment(deployment));
    const at = new Date("2026-08-24T09:00:00Z");

    monitor.telemetry.observe(
      "syrax-mistral",
      headers({
        "x-ratelimit-limit-req-minute": "188",
        "x-ratelimit-remaining-req-minute": "187",
        "x-ratelimit-limit-tokens-minute": "625000",
        "x-ratelimit-remaining-tokens-minute": "624982",
      }),
      at,
    );
    const source = monitor.sources().find((one) => one.provider === "syrax-mistral")!;

    assert.equal(source.headroom.kind, "reported");
    assert.deepEqual(source.headroom.kind === "reported" ? source.headroom.rungs.requests : null, {
      window: "minute",
      remaining: 187,
      limit: 188,
    });
    assert.equal(source.lastReadAt, at.toISOString());
  });

  it("says unknown, not a quiet day, once a source stops parsing", () => {
    const { deployment } = temporaryMachine();
    const monitor = new LaneMonitor(readDeployment(deployment));
    const read = new Date("2026-08-24T09:00:00Z");

    monitor.telemetry.observe(
      "syrax-groq",
      headers({
        "x-ratelimit-limit-requests": "1000",
        "x-ratelimit-remaining-requests": "998",
      }),
      read,
    );
    monitor.telemetry.observe("syrax-groq", headers({ "x-quota-left": "998" }), new Date());
    const source = monitor.sources().find((one) => one.provider === "syrax-groq")!;

    assert.equal(source.headroom.kind, "unknown");
    assert.equal(source.lastReadAt, read.toISOString(), "it lost when it last understood it.");
  });

  it("says unknown for a provider that has never been read", () => {
    const { deployment } = temporaryMachine();
    const sources = new LaneMonitor(readDeployment(deployment)).sources();

    for (const provider of ["syrax-mistral", "syrax-groq", "syrax-zai"]) {
      const source = sources.find((one) => one.provider === provider)!;
      assert.equal(source.headroom.kind, "unknown");
      assert.equal(source.lastReadAt, null);
    }
  });
});

describe("the hatch over MCP", () => {
  it("offers one tool, and a call on it spends a rung", async () => {
    const stub = await ProviderStub.start({ standingReply: { kind: "reply", text: "considered" } });
    after(() => stub.close());
    const deployment = await monitorOn(stub);
    const { server, port } = await serveLaneMonitor({ ...deployment, monitorPort: 0 });
    after(() => new Promise((resolve) => server.close(() => resolve(undefined))));
    const endpoint = `http://127.0.0.1:${port}${mcpPath}`;

    const listed = await rpc(endpoint, { id: 1, method: "tools/list" });
    const called = await rpc(endpoint, {
      id: 2,
      method: "tools/call",
      params: { name: hatchToolName, arguments: { question: "a hard one", askedFor } },
    });

    assert.deepEqual(
      (listed.result as { tools: { name: string }[] }).tools.map((tool) => tool.name),
      [hatchToolName, reportToolName, standDownToolName, removeRungToolName],
    );
    const answered = (called.result as { structuredContent: { reached: boolean; answer: string } })
      .structuredContent;
    assert.equal(answered.reached, true);
    assert.equal(answered.answer, "considered");
  });

  it("answers a tool that throws rather than taking the unit down with it", async () => {
    const endpoint = mcpEndpoint(monitorServerName, [
      {
        name: hatchToolName,
        description: "one that fails",
        inputSchema: { type: "object" },
        call: () => Promise.reject(new Error("the counters could not be written")),
      },
    ]);
    const server = createServer((request, response) => void endpoint(request, response));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    after(() => new Promise((resolve) => server.close(() => resolve(undefined))));
    const port = (server.address() as { port: number }).port;

    const called = await rpc(`http://127.0.0.1:${port}${mcpPath}`, {
      id: 1,
      method: "tools/call",
      params: { name: hatchToolName, arguments: {} },
    });

    assert.equal((called.error as { code: number }).code, -32603);
    assert.match((called.error as { message: string }).message, /counters could not be written/);
  });

  it("names itself to a client that initializes, and answers no unknown method", async () => {
    const { deployment } = temporaryMachine();
    const { server, port } = await serveLaneMonitor({
      ...readDeployment(deployment),
      monitorPort: 0,
    });
    after(() => new Promise((resolve) => server.close(() => resolve(undefined))));
    const endpoint = `http://127.0.0.1:${port}${mcpPath}`;

    const initialized = await rpc(endpoint, { id: 1, method: "initialize", params: {} });
    const unknown = await rpc(endpoint, { id: 2, method: "resources/list" });

    assert.equal(
      (initialized.result as { serverInfo: { name: string } }).serverInfo.name,
      monitorServerName,
    );
    assert.equal((unknown.error as { code: number }).code, -32601);
  });
});

describe("the rationed lane's composition", () => {
  it("sits in no chain, so nothing in the runtime can walk it", () => {
    const chained = [...frontLane.rungs, ...workerLane.rungs].map(modelRef);
    for (const rung of hatchLane.rungs) assert.ok(!chained.includes(rungId(rung)));
  });

  it("holds the rows measured as buckets of their own, and no alias or withdrawn name", () => {
    assert.deepEqual(
      hatchLane.rungs.map((rung) => rung.modelId),
      ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3-flash-preview"],
      "a row joins this list from a measurement, never from a catalogue.",
    );
  });

  it("is reached from every chat, being a lane rather than one chat's capability", () => {
    const { deployment } = temporaryMachine();
    const config = buildRuntimeConfig(
      readDeployment(deployment),
      { general: 2, academic: 3, media: 4, system: 5 },
      [],
    );
    const servers = config.mcp.servers as Record<string, { url: string; transport: string }>;

    assert.equal(servers[monitorServerName]!.url, `http://127.0.0.1:18791${mcpPath}`);
    assert.equal(servers[monitorServerName]!.transport, "streamable-http");
    for (const agent of config.agents.list) {
      assert.ok(agent.tools.alsoAllow.includes(hatchTool), `${agent.id} cannot reach the hatch.`);
    }
  });
});

function headers(given: Record<string, string>) {
  return { get: (name: string) => given[name] ?? null };
}

async function rpc(
  endpoint: string,
  message: { id: number; method: string; params?: Record<string, unknown> },
): Promise<{ result?: unknown; error?: unknown }> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", ...message }),
  });
  return (await response.json()) as { result?: unknown; error?: unknown };
}
