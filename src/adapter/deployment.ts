/**
 * What one machine supplies to the configuration contract: the roots the runtime must be told
 * about rather than left to choose, the single account the bot answers, and the two wires.
 */

import type { ProviderId } from "./lane.ts";

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
  /** The provisioning map: which topic carries each chat, rewritten wherever a send heals one. */
  carrierMap: string;
  /** Where both log surfaces land: the runtime's own file, and the capture beside it (ADR-0020). */
  logsDir: string;
  /** The wrapper the LaunchAgent runs instead of the binary, and never the binary (ADR-0005). */
  wrapperPath: string;
  /** Where the search unit's Python environment was created, outside the checkout. */
  searchRoot: string;
  /** The index, the failure ledger and the pinned export: private runtime state (ADR-0004). */
  searchIndex: string;
  /** The search unit's own wrapper, in the gateway's shape. */
  searchWrapperPath: string;
  /** The loopback port the four agents reach the search unit on. */
  searchPort: number;
  /**
   * The named scopes the search unit maps to roots. The unit reads them from this same file; the
   * adapter reads them only to refuse a chat whose scope no machine configured.
   */
  searchScopes: Record<string, string>;
  /** The one loopback port a gateway listens on; the suite moves its own off the supervised one. */
  gatewayPort: number;
  /** The only Telegram account that is answered. Everything else gets nothing. */
  ownerTelegramUserId: number;
  /** Bot API root. The suite stands a local stub here to drive the Telegram wire. */
  telegramApiRoot: string;
  /** The suite points these at a local OpenAI-compatible stub so no test spends quota. */
  providerBaseUrls: Record<ProviderId, string>;
};

export const telegramApiRoot = "https://api.telegram.org";

/** The runtime's own default, stated so two gateways on one machine collide visibly (ADR-0017). */
export const gatewayPort = 18789;

/** One above the gateway's, so a `lsof` on either reads as the unit it belongs to. */
export const searchPort = 18790;

export const providerBaseUrls: Record<ProviderId, string> = {
  "syrax-gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
  "syrax-mistral": "https://api.mistral.ai/v1",
  "syrax-groq": "https://api.groq.com/openai/v1",
  // The general API rather than the Coding Plan endpoint: the worker's floor is a free general
  // model, and the Coding Plan URL answers only a Coding Plan key.
  "syrax-zai": "https://api.z.ai/api/paas/v4",
};

export class InvalidDeployment extends Error {}

const requiredPaths = [
  "runtimeRoot",
  "configPath",
  "stateDir",
  "workspace",
  "secretsStore",
  "carrierMap",
  "logsDir",
  "wrapperPath",
  "searchRoot",
  "searchIndex",
  "searchWrapperPath",
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
    runtimeRoot: input.runtimeRoot as string,
    configPath: input.configPath as string,
    stateDir: input.stateDir as string,
    workspace: input.workspace as string,
    secretsStore: input.secretsStore as string,
    carrierMap: input.carrierMap as string,
    logsDir: input.logsDir as string,
    gatewayPort: readPort(input.gatewayPort, gatewayPort),
    wrapperPath: input.wrapperPath as string,
    searchRoot: input.searchRoot as string,
    searchIndex: input.searchIndex as string,
    searchWrapperPath: input.searchWrapperPath as string,
    searchPort: readPort(input.searchPort, searchPort),
    searchScopes: readSearchScopes(input.searchScopes),
    ownerTelegramUserId: ownerTelegramUserId as number,
    telegramApiRoot: readUrl(input.telegramApiRoot, "telegramApiRoot") ?? telegramApiRoot,
    providerBaseUrls: readProviderBaseUrls(input.providerBaseUrls),
  };
}

function readPort(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 65535) {
    throw new InvalidDeployment("a port must be a port number.");
  }
  return value as number;
}

function readSearchScopes(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidDeployment("searchScopes maps a scope name to one root.");
  }
  for (const [scope, root] of Object.entries(value)) {
    if (typeof root !== "string" || !root.startsWith("/")) {
      throw new InvalidDeployment(`searchScopes.${scope} must be an absolute path.`);
    }
  }
  return { ...(value as Record<string, string>) };
}

function readUrl(value: unknown, key: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !URL.canParse(value)) {
    throw new InvalidDeployment(`${key} must be a URL.`);
  }
  return value;
}

/**
 * A misspelt provider silently leaves the production URL in place, which is a test that passes
 * having spent real quota — so an unknown key is refused rather than merged over.
 */
function readProviderBaseUrls(value: unknown): Record<ProviderId, string> {
  if (value === undefined) return { ...providerBaseUrls };
  if (typeof value !== "object" || value === null) {
    throw new InvalidDeployment("providerBaseUrls must be an object keyed by provider.");
  }
  const overrides = Object.entries(value).map(([provider, url]) => {
    if (!(provider in providerBaseUrls)) {
      throw new InvalidDeployment(
        `providerBaseUrls names ${provider}, which is not a provider: ${Object.keys(providerBaseUrls).join(", ")}.`,
      );
    }
    return [provider, readUrl(url, `providerBaseUrls.${provider}`)] as const;
  });
  return { ...providerBaseUrls, ...Object.fromEntries(overrides) };
}
