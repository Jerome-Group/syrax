import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { writePrivateFile } from "../src/adapter/private-state.ts";
import type { Landed } from "../src/adapter/runtime-command.ts";
import { runtimeIsInstalled, standSyrax, turn, type SyraxFixture } from "./gateway.ts";

it(
  "confirms an isolated gateway restart before the next turn uses the written model",
  {
    skip: !runtimeIsInstalled(),
    timeout: 150_000,
  },
  async () => {
    const initial = "gemini-3.5-flash-lite";
    const replacement = "ministral-3b-latest";
    const syrax = await standSyrax({ catalogue: [initial, replacement] });
    try {
      assert.equal((await turn(syrax, "Which model answers?")).model, initial);
      const path = syrax.gateway.deployment.configPath;
      const config = JSON.parse(readFileSync(path, "utf8"));
      config.agents.defaults.model = { primary: `syrax-mistral/${replacement}`, fallbacks: [] };
      writePrivateFile(path, `${JSON.stringify(config, null, 2)}\n`);

      const restarted = await restartAt(syrax);
      assert.equal(restarted.landed, true, restarted.said);
      assert.match(restarted.said, /channel reconnected afterward/);
      assert.equal((await turn(syrax, "Which model answers now?")).model, replacement);
    } finally {
      await syrax.stop();
    }
  },
);

function restartAt(syrax: SyraxFixture): Promise<Landed> {
  const module = new URL("../src/adapter/runtime-command.ts", import.meta.url).href;
  const source = `import { landBySafeRestart } from ${JSON.stringify(module)};
process.stdout.write(JSON.stringify(await landBySafeRestart(JSON.parse(process.argv[1]))));`;
  return new Promise((resolve, reject) => {
    const ran = spawn(
      process.execPath,
      ["--input-type=module", "-e", source, JSON.stringify(syrax.gateway.deployment)],
      {
        env: syrax.gateway.environment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let out = "";
    let said = "";
    ran.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
    ran.stderr.on("data", (chunk: Buffer) => (said += chunk.toString("utf8")));
    ran.once("error", reject);
    ran.once("close", (code) => {
      if (code !== 0) return reject(new Error(`restart fixture exited ${code}: ${said}`));
      try {
        resolve(JSON.parse(out) as Landed);
      } catch (error) {
        reject(error);
      }
    });
  });
}
