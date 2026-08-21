/**
 * How everything Syrax writes outside the checkout is written: private, and set rather than
 * requested. A `mode` on `mkdirSync` applies only to a directory the call creates, and each of
 * these may already exist at whatever the umask left it — so every one is chmod'd after the fact.
 */

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const directoryMode = 0o700;
const fileMode = 0o600;

export function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: directoryMode });
  chmodSync(path, directoryMode);
}

export function writePrivateFile(path: string, contents: string): void {
  ensurePrivateDirectory(dirname(path));
  writeFileSync(path, contents, { mode: fileMode });
  chmodSync(path, fileMode);
}
