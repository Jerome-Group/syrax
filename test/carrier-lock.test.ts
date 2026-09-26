import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { withCarrierLock } from "../src/surface/carrier-lock.ts";

it("releases the carrier lock after an operation fails", { timeout: 10_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "syrax-lock-test-"));
  const path = join(root, "carriers.json");
  await assert.rejects(
    withCarrierLock(path, async () => {
      throw new Error("synthetic failure");
    }),
    /synthetic failure/,
  );
  assert.equal(await withCarrierLock(path, async () => "recovered"), "recovered");
  assert.equal(statSync(`${path}.lock`).mode & 0o777, 0o600);
  assert.equal(statSync(root).mode & 0o777, 0o700);
});

it(
  "releases a separate process's carrier lock when that parent crashes",
  { timeout: 10_000 },
  async () => {
    const path = join(mkdtempSync(join(tmpdir(), "syrax-lock-crash-")), "carriers.json");
    const module = new URL("../src/surface/carrier-lock.ts", import.meta.url).href;
    const source = `import { withCarrierLock } from ${JSON.stringify(module)};
await withCarrierLock(process.argv[1], async () => {
  process.stdout.write("held\\n");
  await new Promise(() => {});
});`;
    const parent = spawn(process.execPath, ["--input-type=module", "-e", source, path], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        parent.once("error", reject);
        parent.once("exit", (code) =>
          reject(new Error(`parent exited ${code} before acquiring its lock`)),
        );
        parent.stdout.once("data", () => resolve());
      });
      const stopped = new Promise<void>((resolve) => parent.once("close", () => resolve()));
      parent.kill("SIGKILL");
      await stopped;
      assert.equal(await withCarrierLock(path, async () => "recovered"), "recovered");
    } finally {
      parent.kill("SIGKILL");
    }
  },
);
