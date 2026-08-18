# The free-token provider landscape

Research for [#4](https://github.com/Jerome-Group/syrax/issues/4). Facts checked against primary
sources on **2026-08-15**; free-tier terms change often, so every load-bearing number carries its
source. Constraints from the ticket: no pay-per-token spend; the runtime is Mac mini resident, so
no local chat models — every candidate is a hosted API.

## Provider matrix

| Provider | Best free model(s) | Context (free) | Rate limits (free) | Speed | Tool calls | Auth | ToS / data notes |
|---|---|---|---|---|---|---|---|
| [Cerebras](https://inference-docs.cerebras.ai/support/rate-limits) | `gpt-oss-120b`, `zai-glm-4.7` (†deprecating), `gemma-4-31b` | 64–65K (131K paid) | 5 RPM, 30K TPM, **1M tokens/day** per model | ~3,000 tok/s (gpt-oss-120b), ~1,000 (glm-4.7), ~1,850 (gemma) | Yes (OpenAI-compatible) | API key | Trial credits expire in 30 days; limits are per model |
| [Groq](https://console.groq.com/docs/rate-limits) | `llama-3.1-8b-instant`, `gpt-oss-120b/20b`, `llama-3.3-70b-versatile`, `qwen3.6-27b` | 131K | 8b-instant: 30 RPM, 14.4K RPD, 500K TPD. 70B-class: 30 RPM, 1K RPD, 100–200K TPD | 280–1,000 tok/s per [model docs](https://console.groq.com/docs/models) | Yes | API key | Org-level limits; cached tokens do not count |
| [Z.AI (Zhipu)](https://docs.z.ai/guides/overview/pricing) | `glm-4.7-flash`, `glm-4.5-flash`, `glm-4.6v-flash` (vision) | 200K, 128K max output | Concurrency-based; free Flash tier reported at concurrency 1 ([exact table behind login](https://z.ai/manage-apikey/rate-limits)) | Moderate; `flashx` is the paid faster lane | Yes ([function calling](https://docs.z.ai/guides/llm/glm-4.7)) | API key (OpenAI-compatible `api.z.ai/api/paas/v4`) | China-based vendor; review [privacy policy](https://docs.z.ai/legal-agreement/privacy-policy) before sending private memory |
| [Google Gemini API](https://ai.google.dev/gemini-api/docs/pricing) | Gemini **3.7 Flash**, **3.6 Flash**, 3.5 Flash/Flash-Lite, 3.1 Flash-Lite, 2.5 family | ~1M (model-dependent) | No longer published; per-account in [AI Studio](https://ai.google.dev/gemini-api/docs/rate-limits). Community-reported ~15 RPM / 1M TPM / ~1,500 RPD for Flash ([unofficial](https://tinkerllm.com/blog/gemini-api-free-tier-limits-rate-quotas/)) | Fast (Flash lane) | Yes | API key | **Free tier content is used to improve Google's products** (i.e. training) per the [pricing page](https://ai.google.dev/gemini-api/docs/pricing) |
| [OpenRouter `:free`](https://openrouter.ai/docs/api-reference/limits) | 15 models on 2026-08-15, incl. `nvidia/nemotron-3-ultra-550b-a55b:free` (1M ctx), `nemotron-3-super-120b-a12b:free`, `openai/gpt-oss-20b:free`, `google/gemma-4-31b-it:free` | 128K–1M | 20 RPM; **50 req/day** (1,000/day after a one-time $10 credit purchase) | Varies by upstream | Yes (most `:free` entries) | API key | Free endpoints "can be rate-limited, rerouted, changed, or unavailable"; per-endpoint data policies differ — check before use |
| [Mistral La Plateforme](https://docs.mistral.ai/admin/user-management-finops/tier) | All API models on the free Experiment plan (incl. Large, Codestral) | Model-dependent (≤128K+) | Not published; "lowest limits, intended for evaluation" ([help center](https://help.mistral.ai/en/articles/698531-why-am-i-hitting-api-rate-limits-and-how-do-i-increase-them)); reported ~1 RPS, 500K TPM, 1B tokens/month ([unofficial](https://freellm.net/providers/mistral-ai)) | Moderate | Yes | API key | Free tier historically required phone verification and data-training consent ([TechCrunch, 2024](https://techcrunch.com/2024/09/17/mistral-launches-a-free-tier-for-developers-to-test-its-ai-models)) — verify at signup |
| [GitHub Models](https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models) | — | — | — | — | — | — | **Retired 2026-07-30.** Playground, catalog, inference API and BYOK all gone. Strike from the list |
| [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/) | Llama/Qwen/Gemma/GPT-OSS family at the edge | Model-dependent | **10,000 neurons/day.** Frontier-class models cost ~127K neurons/M input tokens → ~78K input tokens/day; only tiny models stretch far | Edge latency, moderate throughput | Some models | Cloudflare API token | Neuron economics make it a utility tier (embeddings, small classifiers), not a chat backbone |
| Subscription piping (Codex etc.) | GPT-5.x via ChatGPT-plan OAuth (`chatgpt.com/backend-api/codex`) | Plan-dependent | Plan quotas, not API quotas | Good | Yes (within Codex) | OAuth (ChatGPT sign-in) | Forking Codex CLI is fine (Apache-2.0); personal use of one's own subscription is informally tolerated, but programmatic third-party backend use is a ToS grey zone and pooling/resale is prohibited ([openai/codex#8338](https://github.com/openai/codex/discussions/8338)) |

† Cerebras has scheduled `zai-glm-4.7` for **deprecation on 2026-08-17** per its
[models overview](https://inference-docs.cerebras.ai/models/overview) — two days after this
research. Do not build on GLM-via-Cerebras.

## Provider notes

### Cerebras — the fast human-facing candidate

The free trial tier gives, **per model**: 5 requests/min, 30K tokens/min, 1M tokens/hour and
**1M tokens/day**, no credit card required
([rate limits](https://inference-docs.cerebras.ai/support/rate-limits)). Free models on
2026-08-15: `gpt-oss-120b` (~3,000 tok/s, 65K context free / 131K paid), `zai-glm-4.7`
(~1,000 tok/s, 64K free — deprecating 2026-08-17) and `gemma-4-31b` (~1,850 tok/s)
([models overview](https://inference-docs.cerebras.ai/models/overview)). The API is
OpenAI-compatible with tool use. Signup includes $5 of credits that expire after 30 days
([pricing](https://www.cerebras.ai/pricing)).

**Fit as the fast human-facing tier: yes, with one caveat.** ~3,000 tok/s makes replies feel
instant, and 1M tokens/day is ample for one person's chat. The caveat is **5 RPM**: fine for a
single human conversing, too tight for an agent loop that fans out tool calls — those belong on a
different tier. An earlier community claim of an 8K free-context cap is outdated; the official
figure is 64–65K.

### Groq — the free-tier volume champion

Per-model free limits from the [official table](https://console.groq.com/docs/rate-limits):
`llama-3.1-8b-instant` 30 RPM / 14,400 req/day / 500K tokens/day; `llama-3.3-70b-versatile`
30 RPM / 1K RPD / 100K TPD; `gpt-oss-120b`, `gpt-oss-20b` and `qwen3.6-27b` 30 RPM / 1K RPD /
200K TPD. All 131K context, tool calling supported, speeds 280–1,000 tok/s
([models](https://console.groq.com/docs/models)). Limits are organisation-level; cached tokens
do not count toward them. 30 RPM makes Groq the natural overflow lane when Cerebras' 5 RPM is
the bottleneck.

### Z.AI (Zhipu) — the strongest free background model

The Owner's "GLM 4.7" is real: **GLM-4.7-Flash** is the free member of the GLM-4.7 family —
200K context, 128K max output, function calling, streaming
([model page](https://docs.z.ai/guides/llm/glm-4.7),
[pricing: free](https://docs.z.ai/guides/overview/pricing)). `glm-4.5-flash` and the vision
model `glm-4.6v-flash` are also free. Limits are expressed as concurrency rather than RPM/TPD;
the free Flash lane is commonly reported at concurrency 1 (the
[official table](https://z.ai/manage-apikey/rate-limits) sits behind a login) — serialised, but
with no meaningful daily token ceiling reported. For long-context background work (summarising,
memory distillation, planning) this is the strongest free model surveyed. Counterweight: Zhipu
is a China-based vendor; route only content the Owner is comfortable leaving the machine.

### Google Gemini — high volume, but free means training data

> **Corrected 2026-08-16.** The community figure below is wrong on the number that matters. Read
> from the Owner's own account, the free tier is **5 RPM / 250K TPM / 20 requests per day**, the
> same for 3.6 and 3.7 — not ~1,500 req/day. See
> [`free-tier-limits.md`](free-tier-limits.md). "High volume" does not describe this tier.

The Owner's "3.6/3.7 flash" is also real: **Gemini 3.7 Flash** and **3.6 Flash** both carry a
free tier, alongside 3.5 Flash/Flash-Lite, 3.1 Flash-Lite and the 2.5 family
([pricing](https://ai.google.dev/gemini-api/docs/pricing)). Google stopped publishing free-tier
rate numbers — they are per-account in
[AI Studio](https://ai.google.dev/gemini-api/docs/rate-limits); community reporting puts Flash
at ~15 RPM / 1M TPM / ~1,500 req/day
([unofficial](https://tinkerllm.com/blog/gemini-api-free-tier-limits-rate-quotas/)). The
deciding fact is on the official pricing page: on the free tier, **content is used to improve
Google's products**; only the paid tier is excluded from training. For a personal chatbot whose
value is private context, that makes Gemini free tier suitable for non-sensitive, high-volume
work only.

### OpenRouter — a rotating free catalog behind one API

Free variants (`:free` suffix) are capped at 20 req/min and **50 req/day**, rising to 1,000/day
after a one-time $10 credit purchase
([limits](https://openrouter.ai/docs/api-reference/limits)). The catalog on 2026-08-15 (live
API check) held 15 free models, including `nvidia/nemotron-3-ultra-550b-a55b:free` with a 1M
context and tool support — frontier-scale for zero dollars, but at 50 requests/day it is a
"few big questions" lane, not a chat lane. OpenRouter warns free endpoints can be rerouted,
changed or withdrawn at any time, and upstream data policies vary per endpoint.

### Mistral — fine as a tertiary

> **[#59](https://github.com/Jerome-Group/syrax/issues/59), 2026-08-18 — provisioned and measured;
> see [`free-tier-limits.md`](free-tier-limits.md#mistral--the-sixth-provider-added-2026-08-18).**
> The plan is called **Free mode** now, not Experiment. There is no per-plan number: limits are
> **per model**, from 25,000 to 1,300,000 tokens/minute, and every model reports its own in its
> response headers. "~1 req/s" is the console's own per-minute rung divided by 60 — the enforced
> bucket is per minute and permits bursts. Phone verification was not required; training consent is
> on by default and opted out of in the console. Nothing here is *tertiary*: on tokens per minute
> Mistral is the widest free lane on the board, and on generation speed (48-109 tok/s) the slowest.

The free Experiment plan still exists but its numbers are no longer published — the
[docs](https://docs.mistral.ai/admin/user-management-finops/tier) point at the admin console;
reporting suggests ~1 req/s and ~1B tokens/month
([unofficial](https://freellm.net/providers/mistral-ai)). Access to the full model range
including Codestral is the draw. Historically the free tier required phone verification and
consent to training use ([TechCrunch](https://techcrunch.com/2024/09/17/mistral-launches-a-free-tier-for-developers-to-test-its-ai-models));
verify the current conditions at signup.

### GitHub Models — retired

**GitHub Models was retired on 2026-07-30** — playground, model catalog, inference API and BYOK
are "no longer available to any customer"
([docs](https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models)).
Any plan built on it is dead; GitHub points users to Azure AI Foundry (paid) or Copilot.

### Cloudflare Workers AI — a utility tier, not a chat tier

The free allocation is **10,000 neurons/day**
([pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)). Neuron cost scales
with model size: a frontier-class model at ~127K neurons per million input tokens leaves only
~78K input tokens/day, while a micro-model (~1.5K neurons/M) stretches to millions. Useful for
embeddings, classification and small edge utilities; not viable as the chat backbone.

### Piping existing chat subscriptions — grey, fragile, personal-use-only

Codex CLI's ChatGPT sign-in routes through `chatgpt.com/backend-api/codex`, and the OAuth flow
has been reverse-engineered into community proxies (e.g.
[codex-proxy](https://github.com/wowyuarm/codex-proxy)) that expose subscription quota as an
OpenAI-compatible API. The legal picture from
[openai/codex#8338](https://github.com/openai/codex/discussions/8338): forking the Apache-2.0
CLI is explicitly fine; using your own subscription in your own tooling is informally
tolerated; account pooling, resale and rate-limit circumvention are prohibited; everything in
between is an unresolved grey zone against consumer ToS language that bars programmatic
extraction. The same shape applies to Claude subscriptions via unofficial proxies. Practical
verdict: acceptable as the Owner's *personal* coding lane through official CLIs, but **not a
foundation for Syrax's provider layer** — an unofficial endpoint can break without notice, and
the downside is a ban on the Owner's primary subscription.

## What "omnirouter" is

The Owner's "omnirouter" is **OmniRoute** ([github.com/diegosouzapw/OmniRoute](https://github.com/diegosouzapw/OmniRoute),
[omniroute.online](https://omniroute.online/), npm package `omniroute`): an MIT-licensed,
open-source **local AI gateway** — not a provider. It runs as a proxy on
`http://localhost:20128/v1`, presents one OpenAI-compatible endpoint, and routes across a
catalog of 270+ providers (90+ with free tiers), with a four-tier fallback (subscription → API
key → cheap → free), 19 routing strategies, circuit breakers and key cooldown. It is mature and
active (~47.8K stars, 320+ contributors). For Syrax it is a candidate **implementation of the
free-tier fallback layer** this document implies — running locally on the Mac mini it adds no
cloud dependency — with two cautions: its subscription-piping tier inherits the ToS grey zone
above, and adopting it is a runtime-adapter-adjacent decision that deserves its own ADR.

## Recommendation

A two-tier split, all free, all key-based, nothing pay-per-token:

1. **Fast human-facing tier: Cerebras `gpt-oss-120b`** — ~3,000 tok/s, 65K context, tool calls,
   1M tokens/day. The only free tier with genuinely interactive speed. Its 5 RPM cap fits a
   single human's chat cadence; **overflow and tool-call fan-out go to Groq**
   (`gpt-oss-120b` at 500 tok/s / 1K req/day, or `llama-3.1-8b-instant` at 560 tok/s /
   14.4K req/day for cheap utility turns).
2. **Strong background tier: Z.AI `glm-4.7-flash`** — 200K context, 128K output, function
   calling, free with a concurrency-1 lane that background jobs tolerate. Secondary volume:
   **Gemini 3.7/3.6 Flash** free tier for non-sensitive bulk work only, because Google trains
   on free-tier content. Big-model escape hatch: **OpenRouter `:free`** (e.g. Nemotron-3 Ultra,
   1M context) within 50 req/day.

Supporting decisions for the tickets this blocks:

- **Do not** build on GLM-via-Cerebras (deprecated 2026-08-17), GitHub Models (retired), or
  subscription piping (ToS risk to the Owner's accounts). Treat Cloudflare Workers AI as a
  utility tier and Mistral as an unranked spare.
- **Evaluate OmniRoute** as the routing/fallback layer before writing a bespoke one; it is MIT,
  local, and already encodes the free-tier catalog. That evaluation is its own decision ticket
  and, if adopted, an ADR.
- **Privacy rule of thumb** for whichever router lands: private memory and sensitive context go
  only to providers that do not train on inputs; Gemini free tier and any free endpoint with an
  unknown data policy get sanitised, non-private work.
