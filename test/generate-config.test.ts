import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { InvalidDeployment, readDeployment } from "../src/adapter/deployment.ts";
import { InsecureSecretsStore } from "../src/adapter/secrets-store.ts";
import { generateConfig } from "../src/cli/generate-config.ts";

function machine(overrides: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), "syrax-generate-"));
  const secrets = join(root, "secrets");
  mkdirSync(secrets);
  const store = join(secrets, "syrax.json");
  writeFileSync(store, "{}");
  chmodSync(store, 0o600);
  chmodSync(secrets, 0o700);
  return {
    root,
    deployment: {
      runtimeRoot: join(root, "runtime"),
      configPath: join(root, "shared", "openclaw.json"),
      stateDir: join(root, "state"),
      workspace: join(root, "workspace"),
      secretsStore: store,
      ownerTelegramUserId: 100000000,
      ...overrides,
    },
  };
}

describe("generating the runtime configuration", () => {
  it("writes it private, whatever mode the directory it lands in already had", () => {
    const { root, deployment } = machine();
    // The ordinary case: a runtime root an earlier install created under the default umask.
    mkdirSync(join(root, "shared"), { recursive: true });
    chmodSync(join(root, "shared"), 0o755);

    const resolved = readDeployment(deployment);
    generateConfig(resolved);

    assert.equal(statSync(resolved.configPath).mode & 0o777, 0o600);
    assert.equal(statSync(join(root, "shared")).mode & 0o777, 0o700);
    assert.equal(statSync(resolved.workspace).mode & 0o777, 0o700);
    assert.equal(statSync(resolved.stateDir).mode & 0o777, 0o700);
  });

  it("puts the standing instruction where the runtime injects it from", () => {
    const { deployment } = machine();
    const resolved = readDeployment(deployment);
    generateConfig(resolved);
    assert.match(
      readFileSync(join(resolved.workspace, "AGENTS.md"), "utf8"),
      /Never state a fact you have not verified/,
    );
  });

  it("refuses a root inside the checkout, where one git add would make it public", () => {
    const { deployment } = machine();
    assert.throws(
      () => generateConfig(readDeployment({ ...deployment, stateDir: import.meta.dirname })),
      /inside the checkout/,
    );
  });

  it("refuses a secrets store the machine has left readable", () => {
    const { deployment } = machine();
    chmodSync(deployment.secretsStore as string, 0o644);
    assert.throws(() => generateConfig(readDeployment(deployment)), InsecureSecretsStore);
  });
});

describe("reading a deployment", () => {
  it("refuses a provider it does not have, rather than leaving the live URL in place", () => {
    const { deployment } = machine({ providerBaseUrls: { "syrax-gemeni": "http://127.0.0.1:1" } });
    assert.throws(() => readDeployment(deployment), InvalidDeployment);
  });

  it("refuses a wire that is not a URL", () => {
    assert.throws(
      () => readDeployment(machine({ telegramApiRoot: ["http://127.0.0.1:1"] }).deployment),
      InvalidDeployment,
    );
  });

  it("keeps the live URL for a provider the deployment says nothing about", () => {
    const { deployment } = machine({
      providerBaseUrls: { "syrax-groq": "http://127.0.0.1:1" },
    });
    const resolved = readDeployment(deployment);
    assert.equal(resolved.providerBaseUrls["syrax-groq"], "http://127.0.0.1:1");
    assert.match(resolved.providerBaseUrls["syrax-gemini"], /^https:\/\/generativelanguage\./);
    assert.match(resolved.providerBaseUrls["syrax-mistral"], /^https:\/\/api\.mistral\.ai/);
  });

  it("carries no key the deployment did not describe", () => {
    const { deployment } = machine({ _comment: "public example files carry one" });
    assert.equal("_comment" in readDeployment(deployment), false);
  });
});
