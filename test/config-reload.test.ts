/**
 * What a write to the generated configuration reaches, and when. Both halves are measured at the
 * provider wire on a running gateway, because "config hot reload applied" is a line in the log
 * rather than an answer to the question the lane monitor and the write path both ask: does the next
 * turn use the file that was just written?
 *
 * Each suite stands its own gateway. A reload deferred by one measurement lands during the next,
 * which is the finding itself and would otherwise read as a flake.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { everyChat } from "../src/adapter/chats.ts";
import { writePrivateFile } from "../src/adapter/private-state.ts";
import { runtimeIsInstalled, runtimeRoot, startGateway, type GatewayFixture } from "./gateway.ts";
import { ownerTelegramUserId } from "./machine.ts";
import { ProviderStub } from "./stubs/openai-provider.ts";
import { TelegramStub, type OutboundCall } from "./stubs/telegram-bot-api.ts";

const answer = "Answered.";
const isAnswer = (call: OutboundCall) => call.body.text === answer;
const gemini = "gemini-3.5-flash-lite";
const mistral = "ministral-3b-latest";

/** One turn, reported as what the prompt carries: the model asked, and the agent that asked. */
type Turn = { model: string; agent: string };

class RunningGateway {
  readonly telegram: TelegramStub;
  readonly provider: ProviderStub;
  readonly gateway: GatewayFixture;
  readonly carriers: Record<string, number>;

  constructor(
    telegram: TelegramStub,
    provider: ProviderStub,
    gateway: GatewayFixture,
    carriers: Record<string, number>,
  ) {
    this.telegram = telegram;
    this.provider = provider;
    this.gateway = gateway;
    this.carriers = carriers;
  }

  static async start(): Promise<RunningGateway> {
    const telegram = await TelegramStub.start("6100000000:STUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTU");
    const carriers: Record<string, number> = {};
    for (const chat of everyChat) carriers[chat.id] = telegram.createTopic();
    const provider = await ProviderStub.start({
      catalogue: [gemini, mistral],
      standingReply: { kind: "reply", text: answer },
    });
    const gateway = await startGateway({
      ownerTelegramUserId,
      telegramApiRoot: telegram.apiRoot,
      telegramBotToken: telegram.botToken,
      providerBaseUrls: {
        "syrax-gemini": provider.baseUrl,
        "syrax-mistral": provider.baseUrl,
        "syrax-groq": provider.baseUrl,
      },
      carriers,
    });
    await telegram.waitFor("getMe");
    return new RunningGateway(telegram, provider, gateway, carriers);
  }

  async stop(): Promise<void> {
    await this.gateway.stop();
    await this.telegram.close();
    await this.provider.close();
  }

  async turn(text: string, carrier?: number): Promise<Turn> {
    const since = this.telegram.matching("sendMessage", isAnswer).length;
    this.telegram.inject({ fromUserId: ownerTelegramUserId, text, messageThreadId: carrier });
    await this.telegram.waitFor("sendMessage", isAnswer, 60_000, since);
    const body = this.provider.requests.at(-1)?.body as { model?: string };
    return {
      model: String(body.model),
      agent: /agent=(\w+)/.exec(JSON.stringify(body))?.[1] ?? "none",
    };
  }

  /** Turns until `landed` holds, or every attempt is spent — the answer being how many it took. */
  async turnsUntil(
    text: string,
    carrier: number | undefined,
    landed: (turn: Turn) => boolean,
    attempts = 6,
  ): Promise<{ turns: Turn[]; landed: boolean }> {
    const turns: Turn[] = [];
    for (let attempt = 1; attempt <= attempts; attempt++) {
      turns.push(await this.turn(`${text} (${attempt})`, carrier));
      if (landed(turns.at(-1)!)) return { turns, landed: true };
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return { turns, landed: false };
  }

  rewrite(change: (config: Record<string, any>) => void): void {
    const config = JSON.parse(readFileSync(this.gateway.deployment.configPath, "utf8"));
    change(config);
    writePrivateFile(this.gateway.deployment.configPath, `${JSON.stringify(config, null, 2)}\n`);
  }

  standDownToMistral(): void {
    this.rewrite((config) => {
      config.agents.defaults.model.primary = `syrax-mistral/${mistral}`;
      config.agents.defaults.model.fallbacks = [];
    });
  }

  logMessages(): string[] {
    return readFileSync(join(this.gateway.deployment.logsDir, "openclaw.log"), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => {
        try {
          return (JSON.parse(line) as { message?: string }).message ?? "";
        } catch {
          return line.slice(0, 200);
        }
      });
  }

  safeRestart(): void {
    const restart = spawnSync(
      process.execPath,
      [
        join(runtimeRoot, "node_modules", "openclaw", "openclaw.mjs"),
        "gateway",
        "restart",
        "--safe",
      ],
      { env: this.gateway.environment, encoding: "utf8" },
    );
    assert.equal(restart.status, 0, restart.stderr);
  }
}

describe("an agent change written to the configuration", { skip: !runtimeIsInstalled() }, () => {
  let running: RunningGateway;

  before(async () => {
    running = await RunningGateway.start();
  });
  after(async () => {
    await running?.stop();
  });

  it("is applied and not landed: no turn uses it until a channel reload rebuilds", async () => {
    // A turn before the write, which both states where this starts and lets the config watcher
    // attach — it is the last thing the gateway starts, after it reports itself ready.
    assert.equal((await running.turn("Which model is this?")).model, gemini);
    running.standDownToMistral();

    const unlanded = await running.turnsUntil(
      "Which model is this?",
      running.carriers.general,
      (turn) => turn.model === mistral,
    );
    assert.equal(
      unlanded.landed,
      false,
      `an agents write reached a turn on its own after ${unlanded.turns.length} of them.`,
    );
    assert.match(
      running.logMessages().join("\n"),
      /config hot reload applied \(agents\.defaults\.model/,
      "the runtime did not even claim to have applied it, which is a different finding.",
    );

    // Nothing here touches the model. Routing a carrier the gateway has not seen is a channel
    // change, and the channel reload it triggers is what rebuilds the turn path.
    const carrier = running.telegram.createTopic();
    running.rewrite((config) => {
      config.channels.telegram.direct[String(ownerTelegramUserId)].topics[String(carrier)] = {
        agentId: "media",
      };
    });

    const landed = await running.turnsUntil(
      "Who answers here?",
      carrier,
      (turn) => turn.agent === "media" && turn.model === mistral,
    );
    assert.ok(landed.landed, `neither write landed: ${JSON.stringify(landed.turns)}`);
    // The reload is deferred until active replies and runs complete, so the first message into a
    // carrier the gateway has not seen can still be answered by the default agent.
    assert.ok(landed.turns.length <= 3, `it took ${landed.turns.length} turns.`);
  });
});

describe("the runtime's own safe restart", { skip: !runtimeIsInstalled() }, () => {
  let running: RunningGateway;

  before(async () => {
    running = await RunningGateway.start();
  });
  after(async () => {
    await running?.stop();
  });

  it("lands an agent change that no number of turns would have landed", async () => {
    assert.equal((await running.turn("Which model is this?")).model, gemini);
    running.standDownToMistral();
    const unlanded = await running.turnsUntil(
      "Which model is this?",
      running.carriers.general,
      (turn) => turn.model === mistral,
      3,
    );
    assert.equal(unlanded.landed, false, "the write landed with no reload and no restart.");

    running.safeRestart();

    const landed = await running.turnsUntil(
      "Which model is this?",
      running.carriers.general,
      (turn) => turn.model === mistral,
    );
    assert.ok(landed.landed, `the restart did not land it either: ${JSON.stringify(landed.turns)}`);
  });
});
