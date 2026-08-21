/**
 * Starts the pinned runtime against a generated configuration, so the suite drives the real
 * gateway at its two wires rather than a stand-in for it.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDeployment, type Deployment } from "../src/adapter/deployment.ts";
import { generateConfig } from "../src/cli/generate-config.ts";
import type { ProviderId } from "../src/adapter/front-lane.ts";

/** Set on the mini, where the suite runs; the gateway-backed tests skip without it. */
export const runtimeRoot = process.env.SYRAX_RUNTIME_ROOT ?? "";

export function runtimeIsInstalled(): boolean {
  return runtimeRoot !== "" && existsSync(runtimeEntrypoint());
}

function runtimeEntrypoint(): string {
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
} as const;

export function writeSecretsStore(root: string, botToken: string): string {
  const directory = join(root, "secrets");
  mkdirSync(directory, { recursive: true });
  const store = join(directory, "syrax.json");
  writeFileSync(
    store,
    JSON.stringify({
      providers: {
        gemini: { apiKey: sentinelKeys.gemini },
        mistral: { apiKey: sentinelKeys.mistral },
        groq: { apiKey: sentinelKeys.groq },
      },
      channels: { telegram: { botToken } },
      gateway: { authToken: "stub-gateway-token" },
    }),
  );
  chmodSync(store, 0o600);
  chmodSync(directory, 0o700);
  return store;
}

export async function startGateway(options: {
  ownerTelegramUserId: number;
  telegramApiRoot: string;
  telegramBotToken: string;
  providerBaseUrls: Record<ProviderId, string>;
}): Promise<GatewayFixture> {
  const root = mkdtempSync(join(tmpdir(), "syrax-skeleton-"));
  const deployment = readDeployment({
    runtimeRoot,
    configPath: join(root, "openclaw.json"),
    stateDir: join(root, "state"),
    workspace: join(root, "workspace"),
    secretsStore: writeSecretsStore(root, options.telegramBotToken),
    ownerTelegramUserId: options.ownerTelegramUserId,
    telegramApiRoot: options.telegramApiRoot,
    providerBaseUrls: options.providerBaseUrls,
  });
  generateConfig(deployment);

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
