/**
 * What one machine supplies to the configuration contract: the roots the runtime must be told
 * about rather than left to choose, the single account the bot answers, and the two wires.
 */

import type { ProviderId } from "./front-lane.ts";

export type Deployment = {
  /** Where `npm ci --prefix` installed the pinned runtime, outside the checkout. */
  runtimeRoot: string;
  /** Where the generated runtime configuration is written; the gateway's OPENCLAW_CONFIG_PATH. */
  configPath: string;
  /** OPENCLAW_STATE_DIR: sessions, channel auth, caches — every byte of private runtime state. */
  stateDir: string;
  /** agents.defaults.workspace, which the runtime otherwise places on the internal disk (ADR-0011). */
  workspace: string;
  /** The one JSON secrets store (ADR-0010). */
  secretsStore: string;
  /** The only Telegram account that is answered. Everything else gets nothing. */
  ownerTelegramUserId: number;
  /** Bot API root. The suite stands a local stub here to drive the Telegram wire. */
  telegramApiRoot: string;
  /** The suite points these at a local OpenAI-compatible stub so no test spends quota. */
  providerBaseUrls: Record<ProviderId, string>;
};

export const telegramApiRoot = "https://api.telegram.org";

export const providerBaseUrls: Record<ProviderId, string> = {
  "syrax-gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
  "syrax-mistral": "https://api.mistral.ai/v1",
  "syrax-groq": "https://api.groq.com/openai/v1",
};

export type DeploymentInput = Omit<Deployment, "telegramApiRoot" | "providerBaseUrls"> &
  Partial<Pick<Deployment, "telegramApiRoot" | "providerBaseUrls">>;

export class InvalidDeployment extends Error {}

const requiredPaths = [
  "runtimeRoot",
  "configPath",
  "stateDir",
  "workspace",
  "secretsStore",
] as const;

export function readDeployment(source: unknown): Deployment {
  if (typeof source !== "object" || source === null) {
    throw new InvalidDeployment("A deployment is a JSON object.");
  }
  const input = source as Record<string, unknown>;

  for (const key of requiredPaths) {
    const value = input[key];
    if (typeof value !== "string" || !value.startsWith("/")) {
      throw new InvalidDeployment(`${key} must be an absolute path.`);
    }
  }

  const ownerTelegramUserId = input.ownerTelegramUserId;
  if (!Number.isSafeInteger(ownerTelegramUserId) || (ownerTelegramUserId as number) <= 0) {
    throw new InvalidDeployment("ownerTelegramUserId must be a positive Telegram user ID.");
  }

  return {
    ...(input as unknown as DeploymentInput),
    telegramApiRoot: (input.telegramApiRoot as string | undefined) ?? telegramApiRoot,
    providerBaseUrls: {
      ...providerBaseUrls,
      ...(input.providerBaseUrls as Partial<Record<ProviderId, string>> | undefined),
    },
  };
}
