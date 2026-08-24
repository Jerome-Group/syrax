/**
 * Starts the pinned runtime against a generated configuration, so the suite drives the real
 * gateway at its two wires rather than a stand-in for it.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readDeployment, type Deployment } from "../src/adapter/deployment.ts";
import { generateConfig } from "../src/adapter/generator.ts";
import type { CarrierMap } from "../src/adapter/carriers.ts";
import { writeCarrierMap } from "../src/adapter/carriers.ts";
import type { ProviderId } from "../src/adapter/lane.ts";
import { everyChat } from "../src/adapter/chats.ts";
import { ownerTelegramUserId, temporaryMachine, writePrivateSecretsStore } from "./machine.ts";
import { ProviderStub } from "./stubs/openai-provider.ts";
import { TelegramStub, type OutboundCall } from "./stubs/telegram-bot-api.ts";

/** Set on the mini, where the suite runs; the gateway-backed tests skip without it. */
export const runtimeRoot = process.env.SYRAX_RUNTIME_ROOT ?? "";

export function runtimeIsInstalled(): boolean {
  return runtimeRoot !== "" && existsSync(runtimeEntrypoint());
}

export function runtimeEntrypoint(): string {
  return join(runtimeRoot, "node_modules", "openclaw", "openclaw.mjs");
}

export type GatewayFixture = {
  deployment: Deployment;
  /** Exactly what the gateway process was handed; nothing else can be inherited. */
  environment: Record<string, string>;
  stop: () => Promise<void>;
};

/** Recognisable stand-ins, so a test can assert these exact bytes reached nothing they should not. */
export const sentinelKeys = {
  gemini: "syrax-sentinel-gemini-key",
  mistral: "syrax-sentinel-mistral-key",
  groq: "syrax-sentinel-groq-key",
  zai: "syrax-sentinel-zai-key",
} as const;

export function writeSecretsStore(path: string, botToken: string): string {
  return writePrivateSecretsStore(path, {
    providers: {
      gemini: { apiKey: sentinelKeys.gemini },
      mistral: { apiKey: sentinelKeys.mistral },
      groq: { apiKey: sentinelKeys.groq },
      zai: { apiKey: sentinelKeys.zai },
    },
    channels: { telegram: { botToken } },
    gateway: { authToken: "stub-gateway-token" },
  });
}

/** Every wire the gateway has pointed at one local stub, which is what makes a run spend nothing. */
export function everyProviderAt(baseUrl: string): Record<ProviderId, string> {
  return {
    "syrax-gemini": baseUrl,
    "syrax-mistral": baseUrl,
    "syrax-groq": baseUrl,
    "syrax-zai": baseUrl,
  };
}

/** The mini runs a supervised gateway on the standing port, so the suite must never take it. */
async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  const server = createServer();
  return await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export async function startGateway(options: {
  ownerTelegramUserId: number;
  telegramApiRoot: string;
  telegramBotToken: string;
  providerBaseUrls: Record<ProviderId, string>;
  /** What the wizard would have provisioned: which topic carries each chat. */
  carriers?: CarrierMap;
  /** Where a search unit is standing, when a suite stands one. */
  searchPort?: number;
  searchScopes?: Record<string, string>;
}): Promise<GatewayFixture> {
  const machine = temporaryMachine({ runtimeRoot });
  const deployment = readDeployment({
    ...machine.deployment,
    secretsStore: writeSecretsStore(machine.deployment.secretsStore, options.telegramBotToken),
    ownerTelegramUserId: options.ownerTelegramUserId,
    gatewayPort: await freePort(),
    telegramApiRoot: options.telegramApiRoot,
    providerBaseUrls: options.providerBaseUrls,
    ...(options.searchPort === undefined ? {} : { searchPort: options.searchPort }),
    ...(options.searchScopes === undefined ? {} : { searchScopes: options.searchScopes }),
  });
  const root = machine.root;
  const carriers = options.carriers ?? {};
  writeCarrierMap(deployment.carrierMap, carriers);
  generateConfig(deployment, carriers);

  // `env -i` but for one process: no provider key can be inherited, because none is exported.
  const environment = {
    PATH: process.env.PATH ?? "",
    HOME: root,
    OPENCLAW_CONFIG_PATH: deployment.configPath,
    OPENCLAW_STATE_DIR: deployment.stateDir,
  };
  const gateway: ChildProcess = spawn(process.execPath, [runtimeEntrypoint(), "gateway"], {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = join(root, "gateway.log");
  gateway.stdout?.on("data", (chunk) => appendTo(log, chunk));
  gateway.stderr?.on("data", (chunk) => appendTo(log, chunk));

  return {
    deployment,
    environment,
    stop: async () => {
      gateway.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 500));
      gateway.kill("SIGKILL");
    },
  };
}

function appendTo(path: string, chunk: Buffer): void {
  writeFileSync(path, chunk, { flag: "a" });
}

/**
 * A gateway with the four chats provisioned and both wires local: what every suite that drives the
 * real runtime needs before it can ask a question. The measurements each suite makes are its own.
 */
export type SyraxFixture = {
  telegram: TelegramStub;
  provider: ProviderStub;
  gateway: GatewayFixture;
  /** Which topic carries each chat, as the wizard would have left it. */
  carriers: Record<string, number>;
  stop: () => Promise<void>;
};

export async function standSyrax(
  options: { catalogue?: string[]; standingReply?: string } = {},
): Promise<SyraxFixture> {
  const telegram = await TelegramStub.start("6100000000:STUBSTUBSTUBSTUBSTUBSTUBSTUBSTUBSTU");
  const carriers: Record<string, number> = {};
  for (const chat of everyChat) carriers[chat.id] = telegram.createTopic();

  const provider = await ProviderStub.start({
    catalogue: options.catalogue ?? ["gemini-3.5-flash-lite"],
    standingReply: { kind: "reply", text: options.standingReply ?? "Answered." },
  });
  const gateway = await startGateway({
    ownerTelegramUserId,
    telegramApiRoot: telegram.apiRoot,
    telegramBotToken: telegram.botToken,
    providerBaseUrls: everyProviderAt(provider.baseUrl),
    carriers,
  });
  await telegram.waitFor("getMe");

  return {
    telegram,
    provider,
    gateway,
    carriers,
    stop: async () => {
      await gateway.stop();
      await telegram.close();
      await provider.close();
    },
  };
}

/** One turn, reported as what the prompt carries: the model asked, and the agent that asked. */
export type Turn = { model: string; agent: string };

/** What every stub in this fixture replies, and what a turn waits for on the way back out. */
export const answer = "Answered.";

/**
 * One turn through the whole thing: injected at the Telegram wire, read at the provider wire. Every
 * suite that drives the real gateway asks the same question of it — *which rung answered* — so the
 * asking lives here rather than once per suite.
 */
export async function turn(syrax: SyraxFixture, text: string, carrier?: number): Promise<Turn> {
  const isAnswer = (call: OutboundCall) => call.body.text === answer;
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
export async function turnsUntil(
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
