/**
 * Both lanes' rungs as runtime provider blocks. Each key is a file-backed SecretRef, so the
 * resolved credential is neither in the gateway's environment nor in anything it writes down.
 *
 * A provider appears once and carries every model either lane reaches it for, because the block is
 * addressed by provider: two lanes naming the same provider are one block with two models in it,
 * and the models are what keep the lanes apart.
 */

import type { Deployment } from "./deployment.ts";
import { frontLane } from "./front-lane.ts";
import type { ProviderId, Rung } from "./lane.ts";
import { secretPaths, secretRef } from "./secrets-store.ts";
import { providerIdleTimeoutSeconds } from "./timeouts.ts";
import { workerLane } from "./worker-lane.ts";

const apiKeyRefs: Record<ProviderId, string> = {
  "syrax-gemini": secretPaths.gemini,
  "syrax-mistral": secretPaths.mistral,
  "syrax-groq": secretPaths.groq,
  "syrax-zai": secretPaths.zai,
};

function modelBlock(rung: Rung) {
  return {
    id: rung.modelId,
    name: rung.name,
    reasoning: rung.reasoning,
    contextWindow: rung.contextWindow,
    maxTokens: rung.maxTokens,
  };
}

export function providerBlocks(deployment: Deployment) {
  const byProvider = new Map<ProviderId, ReturnType<typeof modelBlock>[]>();
  for (const rung of [...frontLane.rungs, ...workerLane.rungs]) {
    byProvider.set(rung.provider, [...(byProvider.get(rung.provider) ?? []), modelBlock(rung)]);
  }

  return Object.fromEntries(
    [...byProvider].map(([provider, models]) => [
      provider,
      {
        baseUrl: deployment.providerBaseUrls[provider],
        apiKey: secretRef(apiKeyRefs[provider]),
        api: "openai-completions",
        // The idle watchdog: how long this provider may say nothing before the rung is dead.
        timeoutSeconds: providerIdleTimeoutSeconds[provider],
        models,
      },
    ]),
  );
}
