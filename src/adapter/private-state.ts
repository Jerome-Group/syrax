/**
 * How everything Syrax writes outside the checkout is written: private, and set rather than
 * requested. A `mode` on `mkdirSync` applies only to a directory the call creates, and each of
 * these may already exist at whatever the umask left it — so every one is chmod'd after the fact.
 */

import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const directoryMode = 0o700;
const fileMode = 0o600;

export function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: directoryMode });
  chmodSync(path, directoryMode);
}

export function writePrivateFile(path: string, contents: string): void {
  ensurePrivateDirectory(dirname(path));
  // Config watchers and ledger readers must see a complete document, even during replacement.
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, contents, { mode: fileMode, flag: "wx" });
    chmodSync(temporary, fileMode);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
