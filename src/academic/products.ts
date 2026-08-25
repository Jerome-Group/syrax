/**
 * The two academic products as commands, which is the whole of refresh-then-read's Syrax half: each
 * product owns its own credentials, its own refresh and its own report, and what Syrax adds is the
 * asking (#10). Nothing here authenticates to anything.
 *
 * Both products speak the same way — a versioned `--json` report on stdout, an exit code beside it
 * — so both are reached through one runner rather than through two shapes that would drift.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import type { AcademicProducts } from "../adapter/deployment.ts";

/** What a product answered: its report where it wrote one, and its own words where it did not. */
export type Ran = {
  ok: boolean;
  code: number | null;
  /** The parsed `--json` report, or null where the product wrote something else. */
  report: unknown;
  said: string;
};

/**
 * A read is bounded so that a product waiting on a provider cannot hold a turn open to the runtime's
 * whole-turn ceiling; the sync, which is minutes of downloading, is not run inside a turn at all.
 */
export const readTimeoutMs = 120_000;
export const auditTimeoutMs = 300_000;
export const writeTimeoutMs = 900_000;

export class UnconfiguredProducts extends Error {}

/**
 * Where each product's entrypoint sits inside its own checkout. `academic-os` is TypeScript built
 * to `dist/` by the Owner and `ntulearn` is run from source; both are the file its own README names,
 * reached directly rather than through `npm run`, which would put a package manager between Syrax
 * and a report it has to parse.
 */
export function academicOsEntrypoint(products: AcademicProducts): string {
  return join(products.academicOsRoot, "dist", "src", "cli.js");
}

export function ntulearnEntrypoint(products: AcademicProducts): string {
  return join(products.ntulearnRoot, "src", "cli.mjs");
}

/**
 * The pair, asked. Every call names the product's own configuration, and nothing else of this
 * machine's: a command must be pointed at the deployment it is acting on rather than at whatever
 * this process inherited, and the product resolves its own credentials from there.
 */
export class Products {
  readonly #products: AcademicProducts;

  constructor(products: AcademicProducts | undefined) {
    if (products === undefined) {
      throw new UnconfiguredProducts(
        "this machine names no academic products, so there is nothing to ask.",
      );
    }
    this.#products = products;
  }

  academicOs(argv: string[], timeoutMs = readTimeoutMs): Promise<Ran> {
    return this.#run(
      academicOsEntrypoint(this.#products),
      [...argv, "--config", this.#products.academicOsConfig, "--json"],
      this.#products.academicOsRoot,
      timeoutMs,
    );
  }

  ntulearn(argv: string[], timeoutMs = readTimeoutMs): Promise<Ran> {
    return this.#run(
      ntulearnEntrypoint(this.#products),
      argv,
      this.#products.ntulearnRoot,
      timeoutMs,
    );
  }

  get paths(): AcademicProducts {
    return this.#products;
  }

  /**
   * Never throws. A product that is not installed, will not start, or runs past its ceiling is an
   * answer the Owner can act on — *the product said this* — where an exception is a tool call that
   * failed for a reason the chat never learns.
   */
  #run(entrypoint: string, argv: string[], cwd: string, timeoutMs: number): Promise<Ran> {
    return new Promise((resolve) => {
      const ran = spawn(process.execPath, [entrypoint, ...argv], {
        cwd,
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      let said = "";
      const ceiling = setTimeout(() => ran.kill("SIGKILL"), timeoutMs);
      ceiling.unref();
      ran.stdout?.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
      ran.stderr?.on("data", (chunk: Buffer) => (said += chunk.toString("utf8")));
      ran.on("error", (error) =>
        resolve({ ok: false, code: -1, report: null, said: error.message }),
      );
      ran.on("close", (code) => {
        clearTimeout(ceiling);
        resolve({
          ok: code === 0,
          code,
          report: parse(out),
          said: said.trim() || out.trim() || "nothing",
        });
      });
    });
  }
}

function parse(out: string): unknown {
  try {
    return JSON.parse(out) as unknown;
  } catch {
    return null;
  }
}
