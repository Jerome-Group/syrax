/**
 * A machine holding both academic products, standing in for them at the seam Syrax actually meets:
 * a command it runs and a file the product left behind. Each stand-in records the argv it was given
 * and prints the report it was scripted with, so a test can assert what crossed to the product —
 * which is the same seam the suite watches the provider and the Bot API at.
 */

import { createServer } from "node:net";
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeCarrierMap } from "../src/adapter/carriers.ts";
import { everyChat } from "../src/adapter/chats.ts";
import { readDeployment, type Deployment } from "../src/adapter/deployment.ts";
import { academicOsEntrypoint, ntulearnEntrypoint } from "../src/academic/products.ts";
import { writeSecretsStore } from "./gateway.ts";
import { temporaryMachine } from "./machine.ts";
import type { TelegramStub } from "./stubs/telegram-bot-api.ts";

export type StandInProducts = {
  root: string;
  deployment: Deployment;
  /** Every command run against each product, one argv per line. */
  academicOsRuns(): string[][];
  ntulearnRuns(): string[][];
  /** Writes one of the mirrors a calendar Refresh leaves behind. */
  writeMirror(role: string, mirror: unknown): void;
  /** Writes the digest ntulearn's watchdog leaves behind. */
  writeVerdict(digest: unknown): void;
  /**
   * Writes one announcement under the modules root, in the shape `ntulearn` writes it: a filename
   * carrying the day it was posted, and a `Created:` line in the body carrying the moment. The two
   * dates are separate arguments from `written`, because a sync catching up writes an old
   * announcement now — which is the case the brief has to tell apart (#182).
   */
  writeAnnouncement(
    where: string,
    title: string,
    dates: { posted?: Date; day?: string; created?: Date | null; written?: Date },
  ): void;
  /** Takes academic-os away, which is what a checkout nobody has built yet looks like. */
  breakAcademicOs(): void;
};

/** The supervised units hold the standing ports, so a suite standing its own takes a free one. */
export async function freePort(): Promise<number> {
  const server = createServer();
  return await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export function standInProducts(
  options: {
    academicOs?: { report?: unknown; exitCode?: number };
    ntulearn?: { report?: unknown; exitCode?: number };
    overrides?: Record<string, unknown>;
    /** A Bot API stub, where the test watches what the desk posts of its own accord. */
    telegram?: TelegramStub;
  } = {},
): StandInProducts {
  const machine = temporaryMachine(options.overrides ?? {});
  const root = machine.root;
  const described = machine.deployment as Record<string, unknown>;
  if (options.telegram !== undefined) {
    writeSecretsStore(described.secretsStore as string, options.telegram.botToken);
    described.telegramApiRoot = options.telegram.apiRoot;
  }
  const deployment = readDeployment(described);
  if (options.telegram !== undefined) {
    writeCarrierMap(
      deployment.carrierMap,
      Object.fromEntries(everyChat.map((chat) => [chat.id, options.telegram!.createTopic()])),
    );
  }
  const products = deployment.academic!;

  const academicOsLog = join(root, "academic-os-runs.log");
  const ntulearnLog = join(root, "ntulearn-runs.log");
  writeCommonJs(
    academicOsEntrypoint(products),
    academicOsLog,
    options.academicOs?.report ?? { outcome: "refreshed" },
    options.academicOs?.exitCode ?? 0,
  );
  writeModule(
    ntulearnEntrypoint(products),
    ntulearnLog,
    options.ntulearn?.report ?? { courses: [], refused: [] },
    options.ntulearn?.exitCode ?? 0,
  );

  return {
    root,
    deployment,
    academicOsRuns: () => runs(academicOsLog),
    ntulearnRuns: () => runs(ntulearnLog),
    writeMirror: (role, mirror) =>
      write(
        join(products.academicOsState, "calendar", "mirrors", `${role.toLowerCase()}.json`),
        JSON.stringify(mirror),
      ),
    writeVerdict: (digest) =>
      write(join(products.ntulearnState, "latest.json"), JSON.stringify(digest)),
    breakAcademicOs: () => rmSync(academicOsEntrypoint(products)),
    writeAnnouncement: (where, title, dates) => {
      const posted = dates.posted ?? new Date();
      const day = dates.day ?? isoDay(posted);
      const created = dates.created === undefined ? posted : dates.created;
      const written = dates.written ?? posted;
      const name = day === "" ? title : `${day} ${title}`;
      const path = join(deployment.searchScopes.academic!, where, "Announcements", `${name}.md`);
      write(
        path,
        [
          `# ${title}`,
          "",
          ...(created === null ? [] : [`- Created: ${created.toISOString()}`]),
          `- Modified: ${written.toISOString()}`,
          "",
          "The body of the announcement.",
          "",
        ].join("\n"),
      );
      utimesSync(path, written, written);
    },
  };
}

function isoDay(when: Date): string {
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function runs(log: string): string[][] {
  try {
    return readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as string[]);
  } catch {
    return [];
  }
}

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

/** `academic-os` ships a built `dist/`, which Node reads as CommonJS without a manifest beside it. */
function writeCommonJs(path: string, log: string, report: unknown, exitCode: number): void {
  write(
    path,
    `const { appendFileSync } = require("node:fs");
appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");
process.stdout.write(${JSON.stringify(JSON.stringify(report))});
process.exitCode = ${exitCode};
`,
  );
}

function writeModule(path: string, log: string, report: unknown, exitCode: number): void {
  write(
    path,
    `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");
process.stdout.write(${JSON.stringify(JSON.stringify(report))});
process.exitCode = ${exitCode};
`,
  );
}
