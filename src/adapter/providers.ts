/**
 * The front lane's rungs as runtime provider blocks. Each key is a file-backed SecretRef, so the
 * resolved credential is neither in the gateway's environment nor in anything it writes down.
 */

import type { Deployment } from "./deployment.ts";
import { frontLane, type ProviderId, type Rung } from "./front-lane.ts";
import { secretPaths, secretRef } from "./secrets-store.ts";

const apiKeyRefs: Record<ProviderId, string> = {
  "syrax-gemini": secretPaths.gemini,
  "syrax-mistral": secretPaths.mistral,
  "syrax-groq": secretPaths.groq,
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
  for (const rung of frontLane) {
    byProvider.set(rung.provider, [...(byProvider.get(rung.provider) ?? []), modelBlock(rung)]);
  }

  return Object.fromEntries(
    [...byProvider].map(([provider, models]) => [
      provider,
      {
        baseUrl: deployment.providerBaseUrls[provider],
        apiKey: secretRef(apiKeyRefs[provider]),
        api: "openai-completions",
        models,
      },
    ]),
  );
}
