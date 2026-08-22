/**
 * The one JSON store every Syrax credential lives in, reached through file-backed SecretRefs
 * (ADR-0010). Nothing resolved is ever written down, and the store's own mode is the protection —
 * so a store the machine has left readable is refused rather than used.
 */

import { readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";

/** The SecretRef provider name the generated configuration refers to the store by. */
export const secretsProviderId = "syrax";

export type SecretRef = {
  source: "file";
  provider: typeof secretsProviderId;
  id: string;
};

export const secretPaths = {
  gemini: "/providers/gemini/apiKey",
  mistral: "/providers/mistral/apiKey",
  groq: "/providers/groq/apiKey",
  zai: "/providers/zai/apiKey",
  telegramBotToken: "/channels/telegram/botToken",
  gatewayAuthToken: "/gateway/authToken",
} as const;

export function secretRef(id: string): SecretRef {
  return { source: "file", provider: secretsProviderId, id };
}

export function secretsProviderBlock(storePath: string) {
  return {
    [secretsProviderId]: {
      source: "file" as const,
      path: storePath,
      mode: "json" as const,
    },
  };
}

export class InsecureSecretsStore extends Error {}

const storeMode = 0o600;
const storeDirectoryMode = 0o700;

/**
 * The runtime refuses an insecure store at the moment of use; this refuses it at the moment of
 * generation, so a wrong mode is a failed provisioning run rather than a gateway that comes up and
 * refuses every turn.
 */
export function assertSecretsStoreIsPrivate(storePath: string): void {
  const directory = statSync(dirname(storePath));
  if ((directory.mode & 0o777) !== storeDirectoryMode) {
    throw new InsecureSecretsStore(
      `${dirname(storePath)} is mode ${(directory.mode & 0o777).toString(8)}, expected 700.`,
    );
  }
  const store = statSync(storePath);
  if ((store.mode & 0o777) !== storeMode) {
    throw new InsecureSecretsStore(
      `${storePath} is mode ${(store.mode & 0o777).toString(8)}, expected 600.`,
    );
  }
}

export class MissingSecret extends Error {}

/**
 * What the runtime resolves a ref to, resolved here for the units that talk to a wire without
 * going through the runtime. Reading is not enough on its own: the store's mode is its protection,
 * so a store the machine has left readable is refused here exactly as it is at generation.
 */
export function readSecret(storePath: string, id: string): string {
  assertSecretsStoreIsPrivate(storePath);
  const path = id.split("/").filter((segment) => segment !== "");
  let held: unknown = JSON.parse(readFileSync(storePath, "utf8"));
  for (const segment of path) {
    if (typeof held !== "object" || held === null) break;
    held = (held as Record<string, unknown>)[segment];
  }
  if (typeof held !== "string" || held === "") {
    throw new MissingSecret(`${storePath} holds nothing at ${id}.`);
  }
  return held;
}
