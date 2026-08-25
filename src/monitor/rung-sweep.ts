/**
 * The daily sweep: one minimal completion per chain rung, which is the only way a rung *beneath*
 * the serving one is ever heard from (ADR-0012).
 *
 * The runtime's decision log is gated on something having already gone wrong, so a chain whose
 * first rung answers every turn writes nothing at all about the three underneath it. Those rungs
 * are invisible until the day the one above them fails — which is precisely the day the rest of the
 * chain is being relied on. So they are asked, and asking costs a request.
 *
 * **A catalogue read would be cheaper and worse than nothing.** #56 measured both catalogues lying
 * in both directions — one omitting free models that work, one listing a model it had already
 * archived — so a free `GET` produces false alarms *and* false silence.
 *
 * **The escape hatch is not swept.** Its rungs carry 20 requests a day each, so one probe is 5% of
 * a rung's day; it makes its own calls and already observes its own refusals beside its counters,
 * which is the same arrangement one level down.
 */

import type { Deployment } from "../adapter/deployment.ts";
import { modelRef, type ProviderId, type Rung } from "../adapter/lane.ts";
import { chainLanes } from "../adapter/lanes.ts";
import { readSecret, secretPaths } from "../adapter/secrets-store.ts";
import { providerIdleTimeoutSeconds } from "../adapter/timeouts.ts";

/**
 * What one rung said when it was asked whether it is still there. `answered` is the only positive
 * fact here: everything else is the provider's own words, kept verbatim because a model that is
 * gone and one that has stopped being free wear the same status code.
 */
export type Swept = {
  rung: string;
  lane: string;
  answered: boolean;
  /** `null` where nothing was served at all — a transport failure or a timeout. */
  status: number | null;
  said: string;
};

/** The smallest question there is. It is a real completion because only a real one is evidence. */
const question = "Reply with the single word: here.";

const maxTokens = 16;

/** Cloudflare answers `403 error code: 1010` to a client whose agent string names a library. */
const userAgent = "syrax-lane-monitor/1.0";

const keyPaths: Record<ProviderId, string> = {
  "syrax-gemini": secretPaths.gemini,
  "syrax-mistral": secretPaths.mistral,
  "syrax-groq": secretPaths.groq,
  "syrax-zai": secretPaths.zai,
};

/**
 * Every chain rung, asked in turn. Rungs already taken out of their lane for good are skipped —
 * a removed rung is not a rung whose absence is news — and the requests are made one after another
 * rather than at once, because seven calls a day have nothing to gain from concurrency.
 */
export async function sweepChainRungs(
  deployment: Deployment,
  removed: readonly string[] = [],
): Promise<Swept[]> {
  const swept: Swept[] = [];
  for (const lane of chainLanes) {
    for (const rung of lane.rungs) {
      if (removed.includes(modelRef(rung))) continue;
      swept.push({ rung: modelRef(rung), lane: lane.name, ...(await ask(deployment, rung)) });
    }
  }
  return swept;
}

/** Never throws: what the call did is the answer, and a thrown failure carries no status to act on. */
async function ask(
  deployment: Deployment,
  rung: Rung,
): Promise<{ answered: boolean; status: number | null; said: string }> {
  let key: string;
  try {
    key = readSecret(deployment.secretsStore, keyPaths[rung.provider]);
  } catch (error) {
    return { answered: false, status: null, said: reason(error) };
  }

  let response: Response;
  try {
    response = await fetch(`${deployment.providerBaseUrls[rung.provider]}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "user-agent": userAgent,
      },
      body: JSON.stringify({
        model: rung.modelId,
        messages: [{ role: "user", content: question }],
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(providerIdleTimeoutSeconds[rung.provider] * 1000),
    });
  } catch (error) {
    return { answered: false, status: null, said: reason(error) };
  }

  if (response.ok) return { answered: true, status: response.status, said: "it answered" };
  return { answered: false, status: response.status, said: await said(response) };
}

/**
 * Gemini answers an error as a one-element array and a gateway in front of a provider answers
 * HTML, so a body that will not parse is reported as the status alone rather than as a second
 * failure on top of the first.
 */
type Refused = { error?: { message?: string } };

async function said(response: Response): Promise<string> {
  try {
    const held = (await response.json()) as Refused | Refused[];
    const body = Array.isArray(held) ? held[0] : held;
    return body?.error?.message ?? `it answered ${response.status} and said nothing`;
  } catch {
    return `it answered ${response.status} and said nothing a reader could keep`;
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
