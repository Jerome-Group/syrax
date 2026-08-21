import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assertSecretsStoreIsPrivate,
  InsecureSecretsStore,
  secretRef,
} from "../src/adapter/secrets-store.ts";

function storeAt(storeMode: number, directoryMode: number): string {
  const directory = mkdtempSync(join(tmpdir(), "syrax-secrets-"));
  const store = join(directory, "syrax.json");
  writeFileSync(store, "{}");
  chmodSync(store, storeMode);
  chmodSync(directory, directoryMode);
  return store;
}

describe("the secrets store", () => {
  it("is accepted at 600 inside a 700 directory", () => {
    assert.doesNotThrow(() => assertSecretsStoreIsPrivate(storeAt(0o600, 0o700)));
  });

  it("is refused rather than used when the machine has left it readable", () => {
    assert.throws(() => assertSecretsStoreIsPrivate(storeAt(0o644, 0o700)), InsecureSecretsStore);
  });

  it("is refused when the directory around it is readable", () => {
    assert.throws(() => assertSecretsStoreIsPrivate(storeAt(0o600, 0o755)), InsecureSecretsStore);
  });

  it("is reached by a file-backed ref, which persists a marker rather than a variable name", () => {
    assert.deepEqual(secretRef("/providers/groq/apiKey"), {
      source: "file",
      provider: "syrax",
      id: "/providers/groq/apiKey",
    });
  });
});
