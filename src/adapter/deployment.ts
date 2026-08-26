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
  /** The lane monitor's counters, stand downs and usage report: what the runtime does not hold. */
  monitorState: string;
  /** The lane monitor's own wrapper, in the gateway's shape. */
  monitorWrapperPath: string;
  /** The loopback port the agents reach the lane monitor's three tools on. */
  monitorPort: number;
  /** The academic desk's own wrapper, in the gateway's shape. */
  academicWrapperPath: string;
  /** The loopback port the Academic agent reaches the desk's tools on, and launchd the brief. */
  academicPort: number;
  /**
   * The two academic products as this machine holds them, or absent on a machine that has not been
   * told where they are. Absent is refused by the generator rather than here, so the Owner meets it
   * at a deploy with the keys named, and never as an Academic chat that answers nothing (ADR-0019).
   */
  academic?: AcademicProducts;
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

/**
 * Where the academic pair lives, and the private roots each product writes its output to. Syrax
 * triggers each product's own refresh and reads what it wrote: no Google and no NTULearn credential
 * is named here, because neither is Syrax's to hold.
 */
export type AcademicProducts = {
  /** The `academic-os` checkout. Its CLI is `dist/src/cli.js`, built there by the Owner. */
  academicOsRoot: string;
  /** Its gitignored local configuration, which is where its own credentials are named. */
  academicOsConfig: string;
  /** Its private `stateRoot`: the calendar mirrors a Refresh writes live under it. */
  academicOsState: string;
  /** The `ntulearn` checkout, whose CLI is `src/cli.mjs`. */
  ntulearnRoot: string;
  /** Its state directory — the parent of the configured `statePath`, holding `latest.json`. */
  ntulearnState: string;
  /**
   * The desk's own private scratch, which holds one thing: the Proposal input it writes for
   * `academic-os` to read back. It is Syrax's rather than either product's because a unit writing
   * into another product's state root is a unit that owns what it did not build.
   */
  academicState: string;
};

export const telegramApiRoot = "https://api.telegram.org";

/** The runtime's own default, stated so two gateways on one machine collide visibly (ADR-0017). */
export const gatewayPort = 18789;

/** One above the gateway's, so a `lsof` on either reads as the unit it belongs to. */
export const searchPort = 18790;

/** One above the search unit's, for the same reason. */
export const monitorPort = 18791;

/** One above the lane monitor's, for the same reason. */
export const academicPort = 18792;

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
  "monitorState",
  "monitorWrapperPath",
] as const;

/** Every path an academic product is reached by. Half a pair is refused: it names a machine that
 * was configured while somebody was interrupted, and a tool that reads one of two products is a
 * chat answering half its questions without saying which half. */
const academicPaths = [
  "academicOsRoot",
  "academicOsConfig",
  "academicOsState",
  "ntulearnRoot",
  "ntulearnState",
  "academicState",
] as const;

export function readDeployment(source: unknown): Deployment {
  if (typeof source !== "object" || source === null) {
    throw new InvalidDeployment("A deployment is a JSON object.");
  }
  const input = source as Record<string, unknown>;

  // A `Deployment` going back in is well-typed, because the parameter is `unknown` and has to be —
  // it validates JSON nobody wrote to a schema. What it is not is *readable*: the academic paths
  // arrive flat and leave nested, so a second pass finds none of them and produces a deployment
  // naming no products. The generator then refuses a machine that named all six, and says so by
  // listing the six keys to add — which sends the reader to the fixture rather than to the call
  // (#196). `academic` is derived and never written in the file, so its presence is the tell. The
  // *object* is: a literal `"academic": null` is somebody spelling out that a machine has none,
  // and refusing that as a double-read would send the reader hunting for a call that never was.
  if (typeof input.academic === "object" && input.academic !== null) {
    throw new InvalidDeployment(
      "This is already a Deployment rather than a deployment file's contents: reading it again " +
        "would drop the academic paths it has derived. Use it as it is.",
    );
  }

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
    monitorState: input.monitorState as string,
    monitorWrapperPath: input.monitorWrapperPath as string,
    monitorPort: readPort(input.monitorPort, monitorPort),
    academicWrapperPath: readAbsolutePath(input.academicWrapperPath, "academicWrapperPath"),
    academicPort: readPort(input.academicPort, academicPort),
    ...readAcademicProducts(input),
    searchScopes: readSearchScopes(input.searchScopes),
    ownerTelegramUserId: ownerTelegramUserId as number,
    telegramApiRoot: readUrl(input.telegramApiRoot, "telegramApiRoot") ?? telegramApiRoot,
    providerBaseUrls: readProviderBaseUrls(input.providerBaseUrls),
  };
}

/**
 * The desk's wrapper defaults beside the other two rather than being required: a machine that never
 * installed the unit still reads its deployment, and the installer is what names the path in anger.
 */
function readAbsolutePath(value: unknown, key: string): string {
  if (value === undefined) return "";
  if (typeof value !== "string" || !value.startsWith("/")) {
    throw new InvalidDeployment(`${key} must be an absolute path.`);
  }
  return value;
}

function readAcademicProducts(input: Record<string, unknown>): { academic?: AcademicProducts } {
  if (academicPaths.every((key) => input[key] === undefined)) return {};
  for (const key of academicPaths) {
    const value = input[key];
    if (typeof value !== "string" || !value.startsWith("/")) {
      throw new InvalidDeployment(
        `${key} must be an absolute path: an academic product is named by all of ${academicPaths.join(", ")} or by none of them.`,
      );
    }
  }
  return {
    academic: Object.fromEntries(
      academicPaths.map((key) => [key, input[key] as string]),
    ) as unknown as AcademicProducts,
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
