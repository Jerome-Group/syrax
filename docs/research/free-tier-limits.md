# The exact free-tier limits behind a login

Research for [#24](https://github.com/Jerome-Group/syrax/issues/24).
[`free-token-providers.md`](free-token-providers.md) surveyed the landscape but could not reach two
sets of numbers, because both sit behind an account. This file reaches them.

**Most of what follows was measured rather than read.** The accounts exist now
([#17](https://github.com/Jerome-Group/syrax/issues/17)), so the console pages are legible and the
APIs answer. Every number below says which it is: read off a page, returned in a header, or
observed by making the call fail on purpose. Facts checked **2026-08-16**, and re-checked against
the pinned runtime on **2026-08-18** — see [Every rung, put on the spot](#every-rung-put-on-the-spot--2026-08-18),
and the inline annotations wherever a 2026-08-16 fact did not survive.

## The short version

| | Gemini 3.6 / 3.7 Flash | Z.AI `glm-4.7-flash` |
|---|---|---|
| Shape of the limit | RPM / TPM / **RPD** | **concurrency**, and only concurrency |
| Free tier | 5 RPM · 250K TPM · **20 RPD** | 1 concurrent request |
| Daily / monthly ceiling | 20 requests/day **is** the ceiling | none published, none observed |
| Do versions differ? | **No** — 3.6 and 3.7 are identical | n/a |
| 429 tells you what? | not established here | **error code**, precisely |
| Rate-limit headers | none | none |

## Gemini — 20 requests a day, and that is the whole story

AI Studio's rate-limit page, on the Owner's own account, for **text-out models**:

| Model | RPM | TPM | RPD |
|---|---|---|---|
| Gemini 3.6 Flash | 5 | 250,000 | **20** |
| Gemini 3.7 Flash | 5 | 250,000 | **20** |

**The two versions are identical**, which answers #24's question directly and means picking between
them is a quality call with no quota consequence.

`free-token-providers.md` recorded the only figure available at the time — community reporting of
~15 RPM / 1M TPM / **~1,500 RPD**. The requests-per-day figure is wrong by **75×**, and it is the
one every plan was resting on. Nothing else in that document depended on it, but #24's premise did:
Gemini was admitted as the *smart tier* on the grounds that nothing private passes through Syrax.
That reasoning survives; what does not survive is the word *tier*. Twenty requests a day is an
escape hatch — something reached for deliberately a few times a day, never something a chat turn
routes to by default.

Both models are live on the account: a `v1beta/models` listing returns `gemini-3.6-flash` and
`gemini-3.7-flash`, each at 1,048,576 input / 65,536 output tokens. The million-token context is
real and the 250K TPM is the practical brake on it — a single maximal request cannot be made at all.

**Tiers, and why none of them apply.** Google's published
[tier ladder](https://ai.google.dev/gemini-api/docs/rate-limits) is Free → Tier 1 (enable billing)
→ Tier 2 ($100 spent, 3 days) → Tier 3 ($1,000 spent, 30 days). Tier 1 is instant on enabling
billing, and it is also the point at which Google stops training on the content. The Owner has ruled
out upgrading, so **Free is the permanent tier** and 20 RPD is a fixed constraint rather than a
starting point.

**What a Gemini 429 carries is not established here.** Confirming it costs 5–6 of the 20 daily
requests to force the failure, which is a quarter of the day's allowance spent on documentation.
The published docs describe `429 RESOURCE_EXHAUSTED` and recommend exponential backoff without
specifying a `Retry-After` header or a `RetryInfo.retryDelay` body field
([troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting)). At 20 RPD the router's
correct behaviour barely depends on the answer: **count locally and stop at 20**, rather than
probing to discover exhaustion.

## Z.AI — one at a time, and the error code is the useful part

The [official rate-limit table](https://z.ai/manage-apikey/rate-limits) is genuinely unreachable
without an account: the documentation path `docs.z.ai/api-reference/rate-limit.md` answers **307**
and redirects to that logged-in console page. Read from the Owner's account, the entry is one line:

> Language Model · GLM-4.7-Flash · **1**

Concurrency 1, and **no daily or monthly token ceiling is shown at all** — the free Flash lane is
metered purely on how many requests may be in flight at once. Community sources reporting ~1,000
requests/day for this tier are not corroborated by anything on the account page; treat the absence
as the finding, and expect no cliff.

**Measured, by sending three concurrent requests:** one returned 200 after 3.4 s. The other two
returned **HTTP 429 in 0.38 s** — rejected immediately, not queued. The body:

```json
{"error":{"code":"1302","message":"Rate limit reached for requests"}}
```

No `Retry-After`, no `X-RateLimit-*`, no reset timestamp. Successful responses carry no rate-limit
headers either.

### The error code answers what the headers do not

#24 asked for a way to distinguish a per-minute stall from an exhausted quota, so
[#15](https://github.com/Jerome-Group/syrax/issues/15)'s router knows whether to wait a second or
stand a provider down for hours. On Z.AI that distinction is **in the error code**, and it is exact
([API error codes](https://docs.z.ai/api-reference/api-code.md)):

| Code | Meaning | What the router should do |
|---|---|---|
| **1302** | request-frequency / concurrency limit | retry in ~1 s — this is the normal case at concurrency 1 |
| **1305** | service temporarily overloaded | retry with backoff |
| **1308** | usage allocation exhausted, resets at a stated time | **stand the provider down** until the reset |
| **1310** | weekly / monthly limit exhausted | stand down for the period |
| **1309**, **1314** | subscription or package expired | stand down until a human acts |
| **1311** | plan lacks access to this model | never retry — a configuration error |
| **1313** | fair-use policy throttle | back off hard |

That is a better signal than a header, because it survives the transport: 1302 and 1308 are both
HTTP 429 and a router that reads only the status code cannot tell them apart. This is the concrete
answer to #7's warning that a daily-exhausted provider 429s every probe for hours and eats
LiteLLM's `allowed_fails` budget — **on Z.AI, the body says which kind of 429 it is.**

### 1305 held the free lane down for half an hour, then let go — 2026-08-17

[#39](https://github.com/Jerome-Group/syrax/issues/39) wanted one small completion out of
`glm-4.7-flash` and could not get one for **~30 minutes**: every request came back **429 with code
1305** — the *service overloaded* row above rather than the 1302 concurrency row — with a single
request in flight and nothing else of ours running. Retrying with backoff, which is what that row
prescribes, did not clear it inside that window. It then recovered on its own, and `glm-4.7-flash`
and `glm-4.5-flash` both answered 200 immediately afterwards.

So 1305 is what the table says it is — temporary — but *temporary* here meant tens of minutes, not
seconds. [#13](https://github.com/Jerome-Group/syrax/issues/13)'s *never dark, only slow* survives
over a day and not over any given half-hour, which is the interval a person waiting on a reply
actually experiences. The floor needs a lane beside it, not a longer backoff.

> **[#56](https://github.com/Jerome-Group/syrax/issues/56), 2026-08-18 — it is neither a wall nor a
> window. It is a rejection rate.** Twenty sequential calls, two seconds apart: `glm-4.7-flash`
> answered **3 of 20**, the other seventeen 429/`1305`. Within the same minute it refused a
> 160-token request and served a 6,458-token one. So [#39](https://github.com/Jerome-Group/syrax/issues/39)'s
> *wall for the whole session* and this section's *recovered after thirty minutes* are both
> descriptions of an 85% coin-flip sampled at different rates — there is no outage to wait out and
> no recovery to detect.
>
> **And it is per model, not per service.** `glm-4.5-flash` on the same key over the same twenty
> calls answered **20 of 20**, median 0.68 s. The *service temporarily overloaded* wording names a
> model's capacity, not Z.AI's, which is why a router reading only the code would stand down a
> provider that has a working free model on it.

**Two more codes, measured while establishing that, and both are the discriminator #15 wanted:**

| Code | HTTP | Sent when | What it means for the router |
|---|---|---|---|
| **1113** | 429 | a **paid** model is asked for on a balance-free key (`glm-4.6`, `glm-4.7-flashx`) | never retry — the model is not on this plan, and the account cannot spend |
| **1214** | 400 | the model id does not exist at all | never retry — a configuration error |

That matters because it is what separates *the free lane is busy* from *you asked for something this
account will never serve*: 1305 is the first, 1113 the second, and only the first is worth waiting
out. It also means the no-spend constraint is enforced by the provider rather than by our restraint —
a paid GLM model returns 1113 rather than a bill.

**The free Flash models are not in the catalogue.** `GET /models` lists nine GLM models
(`glm-4.5` … `glm-5.3`) and **no `-flash` variant at all**, yet `glm-4.7-flash` and `glm-4.5-flash`
both answer. So the catalogue endpoint cannot be used to check whether a free rung still exists —
only a request can, and a `1214` is the only reliable *gone* signal.

> **[#56](https://github.com/Jerome-Group/syrax/issues/56), 2026-08-18 — and Cerebras' catalogue is
> unreliable in the other direction.** It listed `zai-glm-4.7`, which served a tool call at 15:2x,
> and answered `404 model_archived` ninety minutes later; the listing had dropped it by then. So
> neither provider's catalogue is an authority on what a rung will do: Z.AI omits models that work,
> Cerebras lists models that stop working. **Only a request answers the question**, and the answer
> has a shelf life measured in hours.

## What the other three providers give away for free

Provisioning probed all five, so the comparison is worth recording even though #24 only asked about
two. This is the shape [#25](https://github.com/Jerome-Group/syrax/issues/25) has to build a usage
report on top of, and it is not uniform.

**Cerebras returns everything, on every response.** Six rungs, each with a limit and a remaining:

```
x-ratelimit-limit-requests-minute: 5        x-ratelimit-limit-tokens-minute: 30000
x-ratelimit-limit-requests-hour:   150      x-ratelimit-limit-tokens-hour:   1000000
x-ratelimit-limit-requests-day:    2400     x-ratelimit-limit-tokens-day:    1000000
```

The per-hour and per-day **request** rungs — 150/hour and 2,400/day — are not in the published
table, which lists only 5 RPM and the token ceilings. Quota awareness on Cerebras needs nothing
built: it is a header read on a call already being made.

> **[#56](https://github.com/Jerome-Group/syrax/issues/56), 2026-08-18 — the rung that binds is
> `tokens-day`, not `requests-day`.** Every prompt token is charged on every call: two identical
> 6,377-token requests consumed 6,189 and 6,177 of the daily budget, and `prompt_tokens_details`
> reported `cached_tokens: 0`. At a measured 6.1K per simple turn and 12.5K per delegating one, the
> 1,000,000/day ceiling is **~160 or ~80 turns** — where 2,400 requests/day would suggest an order
> of magnitude more. Reasoning about Cerebras in requests overstates it by 15-30×.

**Groq returns limits plus an explicit reset duration** — `x-ratelimit-reset-requests: 6s`,
`x-ratelimit-reset-tokens: 370ms`. A duration rather than a timestamp, so no clock-skew handling is
needed. Measured TPM for `llama-3.1-8b-instant` is **6,000**, which the published table does not
carry.

> **[#56](https://github.com/Jerome-Group/syrax/issues/56), 2026-08-18.** That model no longer
> exists ([#39](https://github.com/Jerome-Group/syrax/issues/39)), and neither does the whole llama
> family. On the models that replaced it the limits are **8,000 TPM and 1,000 requests/day**, and
> both are **per model**: burning 2,873 tokens on `openai/gpt-oss-20b` left `openai/gpt-oss-120b`
> reporting a full 8,000 and `qwen/qwen3.6-27b` its own. The reset durations are computed rather
> than tracked — 1 request of 1,000 reports `1m26.4s`, which is 1/1000 of a day.

**OpenRouter exposes the key itself** at `GET /api/v1/key`, returning usage, the spend cap and
`is_free_tier`. Nothing about per-model quota, but the daily `:free` allowance is derivable from
`is_free_tier` alone (below).

**Z.AI, Gemini and OpenRouter return no rate-limit headers on a successful call.** Three of five
providers say nothing until you fail — so any usage report is a mix of headers, key endpoints and
locally-kept counters, and it cannot be built as one uniform read.

### Cached tokens

- **Z.AI**: cached input, cached-input storage and output are all priced **Free** for the Flash
  family ([pricing](https://docs.z.ai/guides/overview/pricing)) — but with no token ceiling to
  count against, the question has no consequence.
- **Groq**: cached tokens do not count toward limits
  ([rate limits](https://console.groq.com/docs/rate-limits)).
- **Gemini**: not documented either way. At 20 RPD the binding constraint is requests, not tokens.
- **Cerebras**: not documented; the headers report actual remaining tokens, so it is observable
  rather than needing to be known.

### OpenRouter, corrected

`free-token-providers.md` recorded 50 requests/day and treated the 1,000/day tier as a $10 purchase
away. The provisioned key reports `is_free_tier: false`, which per
[the limits doc](https://openrouter.ai/docs/api-reference/limits) means credits have been purchased
at some point — so **`:free` models already run at 20 RPM / 1,000 requests per day**. The purchase
decision #17 deferred to #15 does not exist.

A separate `limit: 1` on the key is a **per-key spending cap of $1**, distinct from the account
balance. It is worth keeping: it makes the no-pay-per-token constraint structural rather than a
matter of routing correctly.

OpenRouter's own 429s carry `X-RateLimit-Limit`, `-Remaining` and `-Reset`, plus `Retry-After` when
every upstream provider returned a retry hint.

## What this means for the tickets waiting on it

- **[#13](https://github.com/Jerome-Group/syrax/issues/13) (token budget and model tiering)** — the
  free capacity is not evenly shaped. Cerebras carries the conversation (2,400 req/day at 5 RPM),
  Groq carries fan-out (14,400 req/day), Z.AI carries anything that tolerates being serialised, and
  **Gemini carries 20 things a day**. A tiering policy that treats Gemini as a general-purpose smart
  tier will exhaust it before lunch.

  > **[#56](https://github.com/Jerome-Group/syrax/issues/56), 2026-08-18 — two of those four are
  > wrong, and both in the direction of overstating what is there.** Cerebras carries **~80-160
  > turns/day**, not 2,400, because the daily *token* rung binds first. Groq carries **no fan-out at
  > all**: 8,000 TPM is a per-request ceiling as well as a per-minute one, and a sub-agent's first
  > call measured 13,200-13,431 tokens, so the request is refused at full quota at any hour. The
  > free capacity is not merely uneven — it is smaller than requests-per-day made it look.
- **[#15](https://github.com/Jerome-Group/syrax/issues/15) (router design)** — the retry signal is
  per-provider and inconsistent: read headers on Cerebras and Groq, read the **error code** on Z.AI,
  and **count locally** on Gemini rather than probing. A uniform "429 means back off" rule is wrong
  on Z.AI, where 1302 is the expected steady state at concurrency 1 and means *retry in a second*.
- **[#25](https://github.com/Jerome-Group/syrax/issues/25) (quota awareness)** — the ticket's worry
  that a single percentage across incompatible meters is a lie is confirmed, and it is worse than it
  looked: three of five providers report nothing at all until they fail. The two units that actually
  exist are *requests against a daily cap* and *concurrent slots*, and only the first is reportable
  as a number that moves during the day.

## Every rung, put on the spot — 2026-08-18

[#56](https://github.com/Jerome-Group/syrax/issues/56) asked what no earlier ticket had: not what a
provider publishes, and not whether it returns 200 to a one-token probe, but whether a rung can
**carry a real turn from the pinned runtime**. Everything below was measured on
`openclaw@2026.6.34`, against the lean prompt configuration, on 2026-08-18.

### What a turn actually costs

The number every rung is judged against, measured rather than assumed:

| | Prompt tokens | Calls |
|---|---|---|
| Simple turn (front lane answers) | **6,115** | 1 |
| Delegating turn (front spawns a sub-agent) | **12,537** | 3 |
| A sub-agent's **first** call, on its own | **13,200-13,431** | 1 |

The last row is the one that decides things. A sub-agent's opening call is *larger* than the whole
front-lane turn that spawned it, because sub-agents receive their own instruction set and tool
schemas, and the schemas dominate at this size.

### The verdict per rung

| Rung | Id today | Tool calls | Carries a real turn | Verdict |
|---|---|---|---|---|
| front 1 — Cerebras | `gpt-oss-120b` ✅ | ✅ | ✅ 8.9 s | **Keep.** Refused twice on `queue_exceeded` capacity, not quota |
| front 2 — Groq | `openai/gpt-oss-120b` ✅ | ✅ | ⚠️ **40.4 s** | **Demote.** Survives by retrying, at 4.5× the latency |
| front 3 — Gemini | `gemini-3.5-flash-lite` ✅ | ✅ | ✅ 1.1 s/call | **Promote.** Fastest failover measured |
| worker 1 — Z.AI | `glm-4.7-flash` ✅ | ✅ | ⚠️ **3 of 20** | **Replace with `glm-4.5-flash`** (20 of 20) |
| worker 2 — Gemini | `gemini-3.1-flash-lite` ✅ | ✅ | ✅ 3.8-11.4 s | **Keep.** |
| worker 3 — OpenRouter | slug **gone** | ✅ | ❌ queue timeout | **Re-slug and demote** |
| worker 4 — Groq | `openai/gpt-oss-20b` ✅ | ✅ | ❌ **413, four times** | **Remove.** Structurally impossible |

**Groq cannot be a worker rung at any hour of any day.** Its 8,000 TPM is a ceiling on the single
request as well as on the minute: a 13.2K sub-agent call is refused `413 Request too large` with the
bucket reporting a full 8,000 remaining. This is not a quota that refills — it is a wall. Four
retries were refused at 13,200, 13,277, 13,354 and 13,431 tokens, each carrying slightly more
context than the last. And the 49% prompt cut the ticket's own comment found does not rescue it:
13.2K is still 65% over.

**Groq as front rung 2 survives a delegating turn only by waiting.** The turn's first call
(6,141 tokens) fits under 8,000; its second does not, and the runtime **retries in place rather than
advancing the chain** — no fallback decision is logged at all. The turn completes, in **40.4 s
against Cerebras' 8.9 s**. That is a rung which degrades the one property the front lane exists for,
so it belongs below Gemini rather than above it.

**The OpenRouter rung named in [ADR-0006](https://github.com/Jerome-Group/syrax/blob/main/docs/adr/0006-the-runtime-routes-and-syrax-owns-the-escape-hatch.md)
no longer exists.** `z-ai/glm-4.7-flash:free` answers `404 … The paid version is available now`.
Fifteen `:free` models do advertise tool support, and `openai/gpt-oss-20b:free` tool-calls on a
small request — but under a real sub-agent turn it failed with *all providers for model are at
capacity (queue timeout)*, which the runtime classified `timeout` rather than `rate_limit`. It is a
tail, not a lane.

**The revised composition, run end to end.** Front `Cerebras → Gemini 3.5 Flash Lite → Groq`, worker
`Z.AI glm-4.5-flash → Gemini 3.1 Flash Lite → Z.AI glm-4.7-flash → OpenRouter`: Cerebras refused on
its 5 RPM, the front fell to Gemini in 1.1 s, the sub-agent ran on `glm-4.5-flash` in 3.4 s, and the
whole delegating turn — **including a front-lane failover** — finished in **2.9 s**. Neither #39 nor
#45 got a chain to do this.

### Model ids rot faster than a decision does

Four rungs named in tickets have disappeared, three of them inside 48 hours:

| Model | Named in | Status |
|---|---|---|
| `llama-3.1-8b-instant` (Groq) | [#17](https://github.com/Jerome-Group/syrax/issues/17) | 404, retired 2026-08-17 |
| `llama-3.3-70b-versatile` (Groq) | [#45](https://github.com/Jerome-Group/syrax/issues/45) | 404, retired 2026-08-17 |
| `z-ai/glm-4.7-flash:free` (OpenRouter) | [#15](https://github.com/Jerome-Group/syrax/issues/15) | 404, no longer free |
| `zai-glm-4.7` (Cerebras) | this session | **archived mid-session** |

Groq's entire llama family is gone; what remains is `openai/gpt-oss-120b`, `openai/gpt-oss-20b`,
`qwen/qwen3.6-27b` and the `groq/compound` pair. The last row is the sharpest: `zai-glm-4.7` was
listed by the catalogue and served a tool call, and ninety minutes later answered
`404 model_archived`. **A chain is a list of names that decay**, and the runtime does advance past a
`model_not_found` — but nothing says the rung has gone, so a chain can rot silently until the lane
runs out of rungs.

### Two things worth knowing that are not about rungs

- **Cerebras and Groq sit behind Cloudflare**, which answers `403 error code: 1010` to a client
  whose User-Agent is `Python-urllib/3.x`. Anything Syrax writes that talks to them directly — the
  escape-hatch counters, the usage report's header reads — needs a normal User-Agent or it will look
  like an auth failure.
- **This session spent ~47% of Cerebras' daily token budget measuring.** Which is the finding above,
  demonstrated: 1,000,000 tokens/day is not a large number when a turn costs six to twelve thousand.

## Sources

- [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) — tier ladder;
  free-tier numbers are per-account and not published here
- [Gemini API troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting) —
  `429 RESOURCE_EXHAUSTED`, backoff guidance
- [Z.AI rate limits](https://z.ai/manage-apikey/rate-limits) — login-gated; the documentation path
  redirects here
- [Z.AI API error codes](https://docs.z.ai/api-reference/api-code.md) — 1302 / 1305 / 1308 / 1310
- [Z.AI pricing](https://docs.z.ai/guides/overview/pricing) — Flash family free, cached input free
- [OpenRouter limits](https://openrouter.ai/docs/api-reference/limits) — `is_free_tier`, 50 vs
  1,000 req/day, 429 headers
- [Cerebras rate limits](https://inference-docs.cerebras.ai/support/rate-limits) and
  [Groq rate limits](https://console.groq.com/docs/rate-limits) — published tables, extended here by
  the response headers each actually returns
