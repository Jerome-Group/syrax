/**
 * What a write to the generated configuration reaches, and when. It is measured at the provider
 * wire on a running gateway, because `config hot reload applied` is a line in the runtime's log
 * rather than an answer to the question the lane monitor and the write path both ask: does the next
 * turn use the file that was just written?
 *
 * Each suite stands its own gateway. A reload deferred by one measurement lands during the next,
 * which is the finding itself and would otherwise read as a flake.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { writePrivateFile } from "../src/adapter/private-state.ts";
import { runtimeEntrypoint, runtimeIsInstalled, standSyrax, type SyraxFixture } from "./gateway.ts";
import { ownerTelegramUserId } from "./machine.ts";
import { ProviderStub } from "./stubs/openai-provider.ts";
import type { OutboundCall } from "./stubs/telegram-bot-api.ts";

const answer = "Answered.";
const isAnswer = (call: OutboundCall) => call.body.text === answer;
const gemini = "gemini-3.5-flash-lite";
const mistral = "ministral-3b-latest";

/** One turn, reported as what the prompt carries: the model asked, and the agent that asked. */
type Turn = { model: string; agent: string };

/** One turn, and what the wire said. */
async function turn(syrax: SyraxFixture, text: string, carrier?: number): Promise<Turn> {
  const since = syrax.telegram.matching("sendMessage", isAnswer).length;
  syrax.telegram.inject({ fromUserId: ownerTelegramUserId, text, messageThreadId: carrier });
  await syrax.telegram.waitFor("sendMessage", isAnswer, 60_000, since);
  const body = syrax.provider.requests.at(-1)?.body as { model?: string };
  return {
    model: String(body.model),
    agent: /agent=(\w+)/.exec(JSON.stringify(body))?.[1] ?? "none",
  };
}

/** Turns until `landed` holds, or every attempt is spent — the answer being how many it took. */
async function turnsUntil(
  syrax: SyraxFixture,
  text: string,
  carrier: number | undefined,
  landed: (turn: Turn) => boolean,
  attempts = 6,
): Promise<{ turns: Turn[]; landed: boolean }> {
  const turns: Turn[] = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    turns.push(await turn(syrax, `${text} (${attempt})`, carrier));
    if (landed(turns.at(-1)!)) return { turns, landed: true };
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return { turns, landed: false };
}

function rewrite(syrax: SyraxFixture, change: (config: Record<string, any>) => void): void {
  const path = syrax.gateway.deployment.configPath;
  const config = JSON.parse(readFileSync(path, "utf8"));
  change(config);
  writePrivateFile(path, `${JSON.stringify(config, null, 2)}\n`);
}

function standDownToMistral(syrax: SyraxFixture): void {
  rewrite(syrax, (config) => {
    config.agents.defaults.model.primary = `syrax-mistral/${mistral}`;
    config.agents.defaults.model.fallbacks = [];
  });
}

/**
 * One turn before any write. It states where the measurement starts, and it lets the config watcher
 * attach — the gateway starts it after reporting itself ready, and a write that beats it is never
 * seen at all.
 */
async function settle(syrax: SyraxFixture): Promise<void> {
  assert.equal((await turn(syrax, "Which model is this?")).model, gemini);
}

describe("an agent change written to the configuration", { skip: !runtimeIsInstalled() }, () => {
  let syrax: SyraxFixture;

  before(async () => {
    syrax = await standSyrax({ catalogue: [gemini, mistral] });
  });
  after(async () => {
    await syrax?.stop();
  });

  it("is applied and not landed: no turn uses it until a channel reload rebuilds", async () => {
    await settle(syrax);
    standDownToMistral(syrax);

    const unlanded = await turnsUntil(
      syrax,
      "Which model is this?",
      syrax.carriers.general,
      (each) => each.model === mistral,
    );
    assert.equal(
      unlanded.landed,
      false,
      `an agents write reached a turn on its own after ${unlanded.turns.length} of them.`,
    );

    // Nothing here touches the model. Routing a carrier the gateway has not seen is a channel
    // change, and the channel reload it triggers is what rebuilds the turn path.
    const carrier = syrax.telegram.createTopic();
    rewrite(syrax, (config) => {
      config.channels.telegram.direct[String(ownerTelegramUserId)].topics[String(carrier)] = {
        agentId: "media",
      };
    });

    const landed = await turnsUntil(
      syrax,
      "Who answers here?",
      carrier,
      (each) => each.agent === "media" && each.model === mistral,
    );
    assert.ok(landed.landed, `neither write landed: ${JSON.stringify(landed.turns)}`);
    // The reload is deferred until active replies and runs complete, so the first message into a
    // carrier the gateway has not seen can still be answered by the default agent.
    assert.ok(landed.turns.length <= 3, `it took ${landed.turns.length} turns.`);
  });
});

describe("a provider change written to the configuration", { skip: !runtimeIsInstalled() }, () => {
  let syrax: SyraxFixture;
  let moved: ProviderStub;

  before(async () => {
    syrax = await standSyrax({ catalogue: [gemini, mistral] });
    moved = await ProviderStub.start({
      catalogue: [gemini, mistral],
      standingReply: { kind: "reply", text: answer },
    });
  });
  after(async () => {
    await syrax?.stop();
    await moved?.close();
  });

  it("goes the same way as an agent change: applied, and landed by the channel reload", async () => {
    await settle(syrax);
    // The front rung's provider is pointed at a second stub. Which one is asked is the answer, and
    // it is a `models` write rather than an `agents` one.
    rewrite(syrax, (config) => {
      config.models.providers["syrax-gemini"].baseUrl = moved.baseUrl;
    });

    const asked = moved.requests.length;
    await turnsUntil(syrax, "Which provider is this?", syrax.carriers.general, () => false, 3);
    assert.equal(moved.requests.length, asked, "a models write reached a turn on its own.");

    const carrier = syrax.telegram.createTopic();
    rewrite(syrax, (config) => {
      config.channels.telegram.direct[String(ownerTelegramUserId)].topics[String(carrier)] = {
        agentId: "media",
      };
    });
    await turnsUntil(syrax, "Who answers here?", carrier, (each) => each.agent === "media");

    assert.ok(moved.requests.length > asked, "the channel reload did not land the models write.");
  });
});

describe("the runtime's own safe restart", { skip: !runtimeIsInstalled() }, () => {
  let syrax: SyraxFixture;

  before(async () => {
    syrax = await standSyrax({ catalogue: [gemini, mistral] });
  });
  after(async () => {
    await syrax?.stop();
  });

  it("lands an agent change that no number of turns would have landed", async () => {
    await settle(syrax);
    standDownToMistral(syrax);
    const unlanded = await turnsUntil(
      syrax,
      "Which model is this?",
      syrax.carriers.general,
      (each) => each.model === mistral,
      3,
    );
    assert.equal(unlanded.landed, false, "the write landed with no reload and no restart.");

    const restart = spawnSync(
      process.execPath,
      [runtimeEntrypoint(), "gateway", "restart", "--safe"],
      { env: syrax.gateway.environment, encoding: "utf8" },
    );
    assert.equal(restart.status, 0, restart.stderr);

    const landed = await turnsUntil(
      syrax,
      "Which model is this?",
      syrax.carriers.general,
      (each) => each.model === mistral,
    );
    assert.ok(landed.landed, `the restart did not land it either: ${JSON.stringify(landed.turns)}`);
  });
});
