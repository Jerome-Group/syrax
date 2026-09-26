import { spawn } from "node:child_process";
import { chmodSync, closeSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { ensurePrivateDirectory } from "../adapter/private-state.ts";

const holdUntilReleased = `process.stdout.write("locked\\n");
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));`;

export async function withCarrierLock<T>(mapPath: string, operation: () => Promise<T>): Promise<T> {
  const path = `${mapPath}.lock`;
  ensurePrivateDirectory(dirname(path));
  closeSync(openSync(path, "a", 0o600));
  chmodSync(path, 0o600);

  // Keep the same inode for all waiters; kernel locks release even when the owning process dies.
  const command = process.platform === "darwin" ? "/usr/bin/lockf" : "/usr/bin/flock";
  const options = process.platform === "darwin" ? ["-k", "-t", "60"] : ["-x", "-w", "60"];
  const holder = spawn(command, [...options, path, process.execPath, "-e", holdUntilReleased], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  // Acquisition reports helper failures; its already-broken input needs no second error.
  holder.stdin.on("error", () => {});
  let said = "";
  holder.stderr.on("data", (chunk: Buffer) => {
    said = (said + chunk.toString("utf8")).slice(-8192);
  });
  const closed = new Promise<void>((resolve) => holder.once("close", () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      holder.once("error", reject);
      holder.once("exit", (code) =>
        reject(new Error(`carrier lock exited ${code}: ${said.trim()}`)),
      );
      holder.stdout.once("data", () => resolve());
    });
    return await operation();
  } finally {
    holder.stdin.end();
    await closed;
  }
}
