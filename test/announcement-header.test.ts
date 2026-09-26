import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { it } from "node:test";
import { announcementsSince } from "../src/academic/ntulearn.ts";
import { standInProducts } from "./academic-machine.ts";

it("reads only the announced header byte budget from a large document", async (context) => {
  const machine = standInProducts();
  machine.writeAnnouncement("MH2500/NTULearn", "Large announcement", {
    posted: new Date("2026-09-26T01:00:00Z"),
  });
  const path = join(
    machine.deployment.searchScopes.academic!,
    "MH2500/NTULearn/Announcements/2026-09-26 Large announcement.md",
  );
  writeFileSync(
    path,
    `# Large announcement\n\n- Created: 2026-09-26T01:00:00Z\n${"large body\n".repeat(100_000)}`,
  );
  const open = fs.open;
  const requested: number[] = [];
  context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const file = await open(...args);
    if (args[0] === path) {
      const read = file.read.bind(file);
      context.mock.method(
        file,
        "read",
        (buffer: Buffer, offset: number, length: number, position: number) => {
          requested.push(length);
          return read(buffer, offset, length, position);
        },
      );
    }
    return file;
  });
  syncBuiltinESMExports();
  context.after(() => {
    context.mock.restoreAll();
    syncBuiltinESMExports();
  });

  const arrived = await announcementsSince(
    machine.deployment.searchScopes.academic!,
    new Date("2026-09-25T00:00:00Z"),
  );

  assert.equal(arrived[0]?.dated, "its own Created line");
  assert.equal(arrived[0]?.at, "2026-09-26T01:00:00.000Z");
  assert.deepEqual(requested, [4096]);
});
