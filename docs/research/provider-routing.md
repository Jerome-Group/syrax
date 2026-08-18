# Provider routing and rate-limit resilience patterns

Research for [#7](https://github.com/Jerome-Group/syrax/issues/7). Facts verified against primary
sources on 2026-08-15; free-tier terms change often, so treat every number here as dated.

**Question:** how do existing systems route across many free-tier providers and survive rate
limits, and what should Syrax reuse rather than build?

**Scope boundary:** the full provider matrix (which providers, which models, exact quotas) is
issue #4's deliverable (`docs/research/free-token-providers.md`). This document covers the
*routing mechanisms* — what the limits look like structurally, the resilience patterns that
survive them, who already implements those patterns, and the reuse recommendation that the
provider-router decision (#15) can act on.

> **Reversed 2026-08-16.** This document's central recommendation — route outside the runtime, in a
> self-hosted OpenAI-compatible gateway process — was **not adopted**. #15 decided there is no
> router process at all: the runtime's own fallback chains route, and Syrax adds only an
> escape-hatch tool and a usage report, neither on the request path. The structural argument in
> §3.3 is **sound and was overruled on measured cost, not refuted** — rediscovering an exhausted
> provider costs one rejection, which is 1 of 2,400 a day against Cerebras and 5% of the day
> against a 20-a-day model, so the expensive case turned out to be the cold, human-invoked one.
> See [ADR-0006](../adr/0006-the-runtime-routes-and-syrax-owns-the-escape-hatch.md). The limits and
> patterns in §1–§2 stand; §3.1's candidate survey and the recommendation below describe a road not
> taken.

---

## 1. What free-tier rate limits actually look like

A router built for paid traffic assumes limits are per-minute and recovery is seconds away.
Free tiers break that assumption in specific, structural ways:

- **Limits stack on multiple windows at once.** Groq's free plan caps requests per minute *and*
  per day, and tokens per minute *and* per day (e.g. `llama-3.1-8b-instant`: 30 RPM, 14.4K RPD,
  6K TPM, 500K TPD) ([Groq rate-limit docs](https://console.groq.com/docs/rate-limits)).
  Cerebras' free tier is 5 RPM / 30K TPM / 1M tokens per hour / 1M tokens per day per model
  ([Cerebras rate-limit docs](https://inference-docs.cerebras.ai/support/rate-limits)). A
  per-minute 429 recovers in seconds; a per-day 429 means that provider is gone until midnight.
  The router must distinguish the two.
- **Some limits are account-wide, not per-key.** Google applies Gemini API limits **per project,
  not per API key** ([Gemini rate-limit docs](https://ai.google.dev/gemini-api/docs/rate-limits)),
  so minting extra keys buys nothing there. Google has also stopped publishing exact free-tier
  numbers on the docs page — they are visible only per-account in AI Studio — so quotas must be
  treated as configuration, not constants.
- **429 responses usually carry recovery hints.** Groq returns `429 Too Many Requests` with a
  `retry-after` header, and exposes `x-ratelimit-remaining-*` / `x-ratelimit-reset-*` headers on
  every response ([Groq rate-limit docs](https://console.groq.com/docs/rate-limits)). A resilient
  client honours `retry-after` instead of blind exponential backoff.
- **Free tiers are throttled hard but can be roomy on tokens.** Mistral's free Experiment plan
  is reported at 1 request/second, 500K tokens/minute, 1B tokens/month, and Mistral no longer
  publishes exact numbers publicly — the admin console is authoritative
  ([Mistral usage-and-limits docs](https://docs.mistral.ai/admin/user-management-finops/tier),
  [pricepertoken survey](https://pricepertoken.com/endpoints/mistral/free)). The scarce resource
  varies by provider: sometimes requests, sometimes tokens, sometimes both.

  > **[#59](https://github.com/Jerome-Group/syrax/issues/59), 2026-08-18 — measured, and all three
  > numbers are wrong as stated.** Limits are per **model**, not per plan: 25,000 TPM on the newest
  > medium, 1,300,000 on `ministral-3b`. The "1 request/second" is the console's per-minute rung
  > divided by 60 and bursts fine. No monthly ceiling is visible anywhere — not on the Limits page,
  > not in a header, and there is no usage endpoint to ask. Mistral does, however, return
  > `x-ratelimit-remaining-tokens-minute` on every response **including its refusals**, which is
  > more than any other provider surveyed here manages. Details in
  > [`free-tier-limits.md`](free-tier-limits.md#mistral--the-sixth-provider-added-2026-08-18).
- **Aggregators have their own meta-limits.** OpenRouter's `:free` model variants are capped at
  20 requests/minute and **50 requests/day** — raised to **1000/day** once the account has ever
  bought at least $10 of credits ([OpenRouter API limits](https://openrouter.ai/docs/api-reference/limits)).
- **Free tiers die.** GitHub Models — a plausible free provider a year ago — was fully retired on
  July 30, 2026: playground, catalog, inference API and BYOK all gone
  ([GitHub Models retirement notice](https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models)).
  Any routing design must treat the provider list as churn-prone configuration, never as code.

**Consequence for Syrax:** surviving free tiers is not one pattern but five composed —
per-deployment quota awareness *before* the call, backoff that honours `retry-after`, cooldowns
long enough to model daily exhaustion, fallback chains across providers, and accounting so the
budget conversation (#13) has data. Each is examined below.

## 2. The resilience patterns

### 2.1 Fallback chains

The baseline pattern everywhere: an ordered list of models/providers tried in sequence when a
call fails. Mature routers distinguish *why* the call failed:

- **General fallbacks** — rate limit or server error: try the next deployment.
- **Context-window fallbacks** — the prompt is too big for this model: skip straight to a
  larger-context model rather than burning retries.
- **Content-policy fallbacks** — one provider's filter refused; another provider may not.

LiteLLM implements all three as separate config keys, applied in order
([LiteLLM reliability docs](https://docs.litellm.ai/docs/proxy/reliability)). OpenRouter exposes
the same idea hosted: a `models` fallback array plus `allow_fallbacks` across providers of the
same model ([OpenRouter provider routing](https://openrouter.ai/docs/features/provider-routing)).
Runtime-level equivalents exist too — Pydantic AI's `FallbackModel` tries models in sequence on
`ModelAPIError` and can also trigger on response content such as truncation
([Pydantic AI model docs](https://pydantic.dev/docs/ai/models/overview/)) — but a runtime-level
chain lives inside one process and forgets everything between processes (see §4).

### 2.2 Key cycling and load balancing

Routers model this as *multiple deployments behind one model name*: N entries that differ only in
API key or provider, load-balanced. LiteLLM's default `simple-shuffle` strategy weights the
shuffle by each deployment's configured RPM/TPM ([LiteLLM routing docs](https://docs.litellm.ai/docs/routing));
Bifrost advertises "intelligent request distribution across API keys" as a headline feature
([Bifrost repo](https://github.com/maximhq/bifrost)); Portkey does weighted distribution across
keys ([Portkey gateway repo](https://github.com/Portkey-AI/gateway)).

Three forms with very different risk profiles:

1. **Across providers** — the safe, load-bearing form for Syrax. Each provider's free quota is an
   independent bucket; the router's job is to drain them in preference order.
2. **Multiple keys within one account** — legitimate where limits are per-key; useless at Google,
   where limits are per project ([Gemini rate-limit docs](https://ai.google.dev/gemini-api/docs/rate-limits)).
3. **Multiple accounts at one provider to multiply free quota** — an evasion pattern. Providers
   meter free tiers per account/project deliberately, run automated abuse monitoring
   ([Gemini usage policies](https://ai.google.dev/gemini-api/docs/usage-policies)), and account
   termination is the enforcement. Syrax's supply of free tokens is its production dependency;
   risking bans to double a quota is a bad trade. **Recommend ruling this form out.**

### 2.3 Cooldown and backoff on 429

Two distinct mechanisms that routers implement separately:

- **Retry with backoff** (per request): LiteLLM retries `RateLimitError` with exponential
  backoff and supports a minimum `retry_after`; Portkey retries up to 5 times with exponential
  backoff ([LiteLLM routing docs](https://docs.litellm.ai/docs/routing),
  [Portkey gateway repo](https://github.com/Portkey-AI/gateway)).
- **Cooldown** (per deployment): after repeated failures the deployment is pulled from rotation.
  LiteLLM's defaults are `allowed_fails: 3` per minute and `cooldown_time: 5` seconds, overridable
  per deployment ([LiteLLM routing docs](https://docs.litellm.ai/docs/routing)).

The free-tier gotcha: a 5-second cooldown is tuned for transient per-minute 429s. A provider that
has exhausted its *daily* quota will 429 every probe for hours, eating the `allowed_fails` budget
each minute. The pattern that works: set per-deployment `rpm`/`tpm` at or just under the
provider's published per-minute quota so the router stops *before* the 429 (pre-call checks
filter deployments that are at their limits — [LiteLLM routing docs](https://docs.litellm.ai/docs/routing)),
and treat any 429 that still arrives as probable daily exhaustion, i.e. configure long
per-deployment cooldowns for the daily-capped providers (Groq, Cerebras, OpenRouter `:free`).
No surveyed router models "requests per day" natively; the long-cooldown approximation is the
practical substitute and is pure configuration.

### 2.4 Model-tier routing (fast vs strong)

Syrax's stated need — a fast human-facing tier and a strong background tier — maps onto the
simplest routing feature there is: **two model groups with stable names** (e.g. `syrax-fast`,
`syrax-strong`), each an independent fallback chain. Every surveyed router supports this because
a model group is just a name bound to a deployment list. The runtime then hard-codes nothing but
the two names, and tier membership is router configuration.

The fancier alternative is *learned* per-prompt routing: RouteLLM (lm-sys) trains a router that
predicts the strong model's win-rate per prompt and claims up to 85% cost reduction at 95% GPT-4
performance, Apache-2.0 ([RouteLLM repo](https://github.com/lm-sys/RouteLLM)); OpenRouter's
hosted Auto Router classifies tasks and routes by observed spend patterns
([OpenRouter model routing](https://openrouter.ai/docs/features/model-routing)). For a
single-user system whose tiers are already semantically determined by the *caller* (a human chat
turn vs a background job), learned routing solves a problem Syrax does not have. **Recommend
static tiers; the caller declares intent by picking the name.**

### 2.5 Token accounting

The gateway is the natural place for accounting because every request already passes through it.
LiteLLM's proxy issues **virtual keys** and enforces budgets per key/user/team with stacked
windows (e.g. a daily *and* a monthly cap on one key), plus per-key `tpm_limit`/`rpm_limit` and
`max_parallel_requests`; it reserves tokens pre-call and reconciles after
([LiteLLM budgets docs](https://docs.litellm.ai/docs/proxy/users)). Bifrost has an equivalent
hierarchy (virtual keys, teams, customer budgets — [Bifrost repo](https://github.com/maximhq/bifrost));
Helicone's gateway rate-limits per user/team in requests, tokens or dollars
([Helicone gateway repo](https://github.com/Helicone/ai-gateway)). On an all-free-tier budget the
dollar figures are notional, but the same machinery answers the questions #13 will ask: which
chat surface consumed which tier, and what drained a quota. One virtual key per chat surface
gives the breakdown for free.

### 2.6 Caching

Every gateway offers exact-match response caching (LiteLLM: in-memory/disk/Redis/S3/GCS;
semantic caching via embeddings against Qdrant/Redis —
[LiteLLM caching docs](https://docs.litellm.ai/docs/proxy/caching); Helicone: Redis/S3
([Helicone gateway repo](https://github.com/Helicone/ai-gateway)); Cloudflare AI Gateway serves
repeats from Cloudflare's cache ([Cloudflare AI Gateway docs](https://developers.cloudflare.com/ai-gateway/));
Portkey and Bifrost offer semantic variants. For a single-user conversational system, exact-match
hit rates approach zero — every prompt embeds fresh history — and semantic caching risks serving
a stale answer to a *similar* question. Provider-side prompt caching (discounted reuse of a
shared prefix) is the variant that actually pays in chat workloads, and it is provider-billing
machinery, not router machinery. **Recommend: no response cache at v1; revisit if repeated
identical background jobs appear.**

## 3. The candidates

### 3.1 Self-hosted gateways

| | LiteLLM proxy | Portkey Gateway | Helicone AI Gateway | Bifrost (Maxim) |
|---|---|---|---|---|
| License | MIT + `enterprise/` carve-out ([LICENSE](https://github.com/BerriAI/litellm/blob/main/LICENSE)) | MIT | Apache-2.0 | Apache-2.0 |
| Stack | Python | Node/TS | Rust (~64 MB claim) | Go |
| Fallback chains | Yes, 3 kinds, in-order | Yes | Yes | Yes |
| Cooldowns on 429 | Yes (`allowed_fails`, `cooldown_time`, per-deployment) | Retries + fallback | Health-based routing | Failover |
| Pre-call quota checks | Yes (per-deployment `rpm`/`tpm`) | Partial (weights) | Rate limits | Rate limits |
| Multi-key balancing | Yes (deployments) | Yes (weighted) | Yes (P2C/latency) | Yes (headline feature) |
| Virtual keys / budgets | Yes, stacked windows | Enterprise | Requests/tokens/dollars | Yes (hierarchical) |
| Caching | Exact + semantic | Enterprise | Redis/S3 | Semantic |
| Activity (2026-08) | 56.3k stars, very active | 12.7k stars, active | ~500 commits, active | 7.3k stars, active |

Sources: [LiteLLM repo](https://github.com/BerriAI/litellm),
[LiteLLM routing](https://docs.litellm.ai/docs/routing) /
[reliability](https://docs.litellm.ai/docs/proxy/reliability) /
[budgets](https://docs.litellm.ai/docs/proxy/users) /
[caching](https://docs.litellm.ai/docs/proxy/caching) docs,
[Portkey repo](https://github.com/Portkey-AI/gateway),
[Helicone repo](https://github.com/Helicone/ai-gateway),
[Bifrost repo](https://github.com/maximhq/bifrost).

LiteLLM is the feature-coverage leader and the only one whose docs directly address every pattern
in §2. Its cost: it is the heaviest. The production guidance is 1 vCPU and **4 GiB memory** per
instance, PostgreSQL for keys/spend, Redis only when running multiple instances
([LiteLLM prod docs](https://docs.litellm.ai/docs/proxy/prod)). A single-user deployment needs
one instance and no Redis, and its real-world footprint on the mini will be far below the
Kubernetes-sized guidance, but on a 16 GB machine shared with other workloads (constraint
recorded on #5) memory is the one number to measure before committing. Helicone (Rust) and
Bifrost (Go) are the lightweight escape hatches with most of the same features; they cost more
configuration novelty and have younger ecosystems.

### 3.2 Hosted routing

- **OpenRouter** is a *provider aggregator*, not infrastructure you run: one API, load-balances
  across upstream providers of the same model by price and stability, retries alternates on
  failure, supports a `models` fallback array
  ([provider routing docs](https://openrouter.ai/docs/features/provider-routing)). Its `:free`
  catalogue (20 RPM; 50 req/day, or 1000/day after a one-time $10 credit purchase —
  [limits docs](https://openrouter.ai/docs/api-reference/limits)) makes it best modelled as **one
  more free-tier provider behind Syrax's own router** — a breadth reserve covering many models
  with one key — not as the router itself: routing through it exclusively adds a third-party
  dependency, its own daily cap, and no visibility into Syrax's other direct free tiers.
- **Cloudflare AI Gateway** proxies BYO-provider calls through Cloudflare with caching, rate
  limiting, retries/fallbacks and cost analytics
  ([Cloudflare AI Gateway docs](https://developers.cloudflare.com/ai-gateway/)). Capable, but it
  puts a hosted third party on the critical path of every private chat turn — against the grain
  of a self-hosted, private-by-default system — and its knobs are a subset of LiteLLM's.

### 3.3 Routing inside the agent runtime

Runtimes increasingly ship fallback primitives — Pydantic AI's `FallbackModel` is a clean example
(sequential attempts on `ModelAPIError`, per-model settings, response-based triggers —
[Pydantic AI model docs](https://pydantic.dev/docs/ai/models/overview/)) — and whatever runtime
#5 selects will have or permit something similar. As the *whole* answer, in-runtime routing
fails structurally:

- **State does not survive the process.** Cooldowns, daily-quota memory and spend counters live
  in one process's memory; every restart (and every second consumer — a cron job, a background
  worker) starts blind and re-discovers exhausted providers by burning requests on 429s.
- **Accounting fragments** across every entrypoint instead of accumulating in one ledger.
- **It couples tier policy to the runtime adapter.** Syrax's runtime is deliberately undecided
  (`CONTEXT.md`); baking the provider chain into runtime code makes the adapter swap that
  #14/#5 contemplate more expensive.

The composition that works: the runtime keeps its *local* resilience (request retries, a
last-ditch fallback), and everything stateful — quotas, cooldowns, chains, accounting — lives in
a gateway the runtime reaches by base URL. Since every surveyed runtime and gateway speaks the
OpenAI-compatible protocol, the seam between them is one URL and one virtual key. This composes
with any outcome of #5: any candidate that can point an OpenAI-style client at a custom base URL
— which is table stakes — inherits the whole routing layer for free.

## 4. Reuse vs build

**Reuse (do not build):** the router engine — fallback ordering, retry/backoff, cooldown
tracking, multi-deployment balancing, virtual keys, budget windows, spend logging. This is
commodity infrastructure with four healthy open-source implementations; Syrax building any of it
is undifferentiated effort plus a maintenance tail.

**Build (thin, Syrax-owned):** the *policy* expressed as gateway configuration — which providers
exist, their measured per-minute quotas as `rpm`/`tpm`, tier membership and chain order for
`syrax-fast` / `syrax-strong`, long cooldowns for daily-capped providers, one virtual key per
chat surface. This is a config file plus the discipline of keeping quota numbers current (they
are per-account and unpublished at Google and Mistral). Live values follow the existing contract:
placeholders in `config/`, real keys outside the repo.

**Explicitly skip at v1:** learned per-prompt routing (RouteLLM-class), response caching,
multi-account key farming, and any hosted gateway on the critical path.

## Recommendation

> **Not adopted — see the note at the top of this file.** Item 1 was reversed by #15 and item 2's
> LiteLLM footprint benchmark was never run, because no gateway process was provisioned. Items 3
> and 4 survive in changed form: the tiers became **lanes** defined by role rather than by strength
> ([#13](https://github.com/Jerome-Group/syrax/issues/13)), and the quota policy became behaviour
> the runtime and one Syrax tool share rather than a gateway's configuration
> ([ADR-0006](../adr/0006-the-runtime-routes-and-syrax-owns-the-escape-hatch.md)).

1. **Route outside the runtime, in a self-hosted OpenAI-compatible gateway process on the mini.**
   In-runtime fallback alone forgets quota state between processes and couples policy to an
   adapter that is deliberately undecided. The runtime talks to one base URL; the seam costs one
   config line in any plausible #5 candidate.
2. **Primary candidate: LiteLLM proxy** (MIT) — the only surveyed router that natively covers the
   full pattern set free tiers demand: per-deployment `rpm`/`tpm` pre-call checks, per-deployment
   cooldowns, in-order fallback chains (general / context-window / content-policy), multi-key
   balancing, virtual keys with stacked budget windows. **Condition:** measure its memory
   footprint on the mini first (production guidance says 4 GiB per instance; a single-user
   instance should sit far below that, but 16 GB is shared). If it fails the measurement,
   **Bifrost** (Go) or **Helicone AI Gateway** (Rust) are the lightweight fallbacks with most of
   the same features. That benchmark is a small task for the #15 decision, not more research.
3. **Model tiers are two static model groups** — `syrax-fast` and `syrax-strong` — each a
   fallback chain in preference order. The caller picks the tier by name; no learned routing.
   Chain membership comes from #4's provider matrix.
4. **Quota policy:** set each deployment's `rpm`/`tpm` just under the provider's per-minute free
   quota so the router exhausts options pre-call instead of collecting 429s; honour `retry-after`
   on the 429s that still happen; give daily-capped providers (Groq, Cerebras, OpenRouter
   `:free`) cooldowns measured in hours, not seconds.
5. **Key cycling is across providers only.** Multiple free accounts at one provider is an abuse
   pattern that risks the accounts Syrax depends on, and per-project limits (Google) defeat it
   anyway. Rule it out in the #15 ADR.
6. **OpenRouter is a provider, not the router:** put its `:free` pool at the tail of both chains
   as a breadth reserve, and consider the one-time $10 credit purchase to lift it from 50 to
   1000 requests/day — the cheapest resilience purchase available if the no-spend constraint
   permits a one-off top-up (that judgement belongs to #13/#15).
7. **Token accounting lives in the gateway:** one virtual key per chat surface, budgets in
   tokens/requests rather than dollars. **No response caching at v1.**
