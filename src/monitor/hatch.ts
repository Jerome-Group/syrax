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

/**
 * Whether the rung's allowance actually went. A **4xx** is the provider answering about the request
 * — a 429 most of all, where the day is its decision and not ours — so it is spent. A **5xx**, and
 * the `null` that stands for a transport failure or a timeout, is a request that was never served:
 * charging for those lets an overloaded backend eat a rung's whole day and then refuse the Owner
 * for the rest of it, which is the ration eating itself (#167).
 */
export function providerCharged(status: number | null): boolean {
  return status !== null && status < 500;
}

/** What the provider did with the call, in the two facts the counters need from it. */
type Served =
  { served: true; answer: string } | { served: false; status: number | null; said: string };

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
    const served = await this.#ask(rung, key, ask);
    if (served.served) {
      return { reached: true, rung: rungId(rung), answer: served.answer, remaining: remaining() };
    }
    if (!providerCharged(served.status)) this.#counters.refund(rung, now);
    this.#counters.refuse(
      rung,
      { at: now.toISOString(), status: served.status, said: served.said },
      now,
    );
    return { reached: false, refused: served.said, remaining: remaining() };
  }

  /**
   * Never throws: what a call did is the answer this returns, because the counters have to act on
   * it and a thrown transport failure carries no status to act on.
   */
  async #ask(rung: RationedRung, key: string, ask: HatchAsk): Promise<Served> {
    let response: Response;
    try {
      response = await this.#send(rung, key, ask);
    } catch (error) {
      return {
        served: false,
        status: null,
        said: `${rungId(rung)} could not be reached: ${reason(error)}`,
      };
    }
    // Read whatever the provider said about itself on the way past, which is the only way any of
    // this reaches telemetry: nothing here is a call made to observe one.
    this.#sources.observe(rung.provider, response.headers);

    const body = await readBody(response);
    if (!response.ok) {
      return {
        served: false,
        status: response.status,
        said: `${rungId(rung)} answered ${response.status}: ${body.error?.message ?? "no message"}`,
      };
    }
    return { served: true, answer: body.choices?.[0]?.message?.content ?? "" };
  }

  #send(rung: RationedRung, key: string, ask: HatchAsk): Promise<Response> {
    return fetch(`${this.#deployment.providerBaseUrls[rung.provider]}/chat/completions`, {
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
    });
  }
}

type CompletionBody = {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
};

/**
 * Gemini answers an error as a one-element array rather than an object, and a gateway in front of a
 * provider answers HTML — so a body that will not parse is an empty one rather than a second
 * failure on top of the first.
 */
async function readBody(response: Response): Promise<CompletionBody> {
  try {
    const held = (await response.json()) as CompletionBody | CompletionBody[];
    return Array.isArray(held) ? (held[0] ?? {}) : held;
  } catch {
    return {};
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
