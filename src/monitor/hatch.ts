/**
 * The escape hatch: the rationed lane reached deliberately, one rung at a time, by a tool that
 * **refuses before it spends** (ADR-0006). That refusal is the whole reason the hatch is a tool
 * rather than a chain rung — a chain member can only be refused by the provider, which costs 5% of
 * a 20-a-day rung's allowance to discover.
 *
 * Two things are refused here and nothing leaves the machine for either. A call the Owner did not
 * ask for in so many words is not the hatch's to make: the lane is rationed because the Owner
 * decides when a day's allowance is worth spending, and a model reaching it on its own judgement is
 * that decision taken away. A day whose rungs are all spent is refused for the reason the counters
 * exist.
 */

import type { Deployment } from "../adapter/deployment.ts";
import { hatchLane, type RationedRung, rungId } from "../adapter/hatch-lane.ts";
import { readSecret, secretPaths } from "../adapter/secrets-store.ts";
import { providerIdleTimeoutSeconds } from "../adapter/timeouts.ts";
import type { DailyCounters, Spent } from "./counters.ts";
import type { TelemetrySources } from "./sources.ts";

export type HatchAsk = {
  /** What the Owner wants answered. */
  question: string;
  /** The Owner's own words asking for the hatch, which is the only thing that opens it. */
  askedFor: string;
};

export type HatchAnswer =
  | { reached: true; rung: string; answer: string; remaining: Spent[] }
  | { reached: false; refused: string; remaining: Spent[] };

/**
 * Cerebras and Groq sit behind Cloudflare, which answers `403 error code: 1010` to a client whose
 * agent string names a library. Stated here rather than per provider so that the next rung this
 * unit calls does not rediscover it as an auth failure.
 */
const userAgent = "syrax-lane-monitor/1.0";

export class EscapeHatch {
  #deployment: Deployment;
  #counters: DailyCounters;
  #sources: TelemetrySources;

  constructor(deployment: Deployment, counters: DailyCounters, sources: TelemetrySources) {
    this.#deployment = deployment;
    this.#counters = counters;
    this.#sources = sources;
  }

  async reach(ask: HatchAsk, now: Date = new Date()): Promise<HatchAnswer> {
    const remaining = () => this.#counters.state(now);
    if (ask.askedFor.trim() === "") {
      return {
        reached: false,
        refused:
          "the hatch is rationed and opens only on the Owner's own explicit ask; nothing was spent",
        remaining: remaining(),
      };
    }
    if (ask.question.trim() === "") {
      return {
        reached: false,
        refused: "there is nothing to ask the rationed lane; nothing was spent",
        remaining: remaining(),
      };
    }
    const rung = hatchLane.rungs.find((one) => this.#counters.remaining(one, now) > 0);
    if (rung === undefined) {
      return {
        reached: false,
        refused: "every rung of the rationed lane is spent until its quota resets",
        remaining: remaining(),
      };
    }

    let key: string;
    try {
      key = readSecret(this.#deployment.secretsStore, secretPaths.gemini);
    } catch (error) {
      return { reached: false, refused: reason(error), remaining: remaining() };
    }

    this.#counters.spend(rung, now);
    try {
      return {
        reached: true,
        rung: rungId(rung),
        answer: await this.#ask(rung, key, ask),
        remaining: remaining(),
      };
    } catch (error) {
      return { reached: false, refused: reason(error), remaining: remaining() };
    }
  }

  async #ask(rung: RationedRung, key: string, ask: HatchAsk): Promise<string> {
    const response = await fetch(
      `${this.#deployment.providerBaseUrls[rung.provider]}/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          "user-agent": userAgent,
        },
        body: JSON.stringify({
          model: rung.modelId,
          messages: [{ role: "user", content: ask.question }],
        }),
        signal: AbortSignal.timeout(providerIdleTimeoutSeconds[rung.provider] * 1000),
      },
    );
    // Read whatever the provider said about itself on the way past, which is the only way any of
    // this reaches telemetry: nothing here is a call made to observe one.
    this.#sources.observe(rung.provider, response.headers);
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(
        `${rungId(rung)} answered ${response.status}: ${body.error?.message ?? "no message"}`,
      );
    }
    return body.choices?.[0]?.message?.content ?? "";
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
