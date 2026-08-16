# The exact free-tier limits behind a login

Research for [#24](https://github.com/Jerome-Group/syrax/issues/24).
[`free-token-providers.md`](free-token-providers.md) surveyed the landscape but could not reach two
sets of numbers, because both sit behind an account. This file reaches them.

**Most of what follows was measured rather than read.** The accounts exist now
([#17](https://github.com/Jerome-Group/syrax/issues/17)), so the console pages are legible and the
APIs answer. Every number below says which it is: read off a page, returned in a header, or
observed by making the call fail on purpose. Facts checked **2026-08-16**.

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

**Groq returns limits plus an explicit reset duration** — `x-ratelimit-reset-requests: 6s`,
`x-ratelimit-reset-tokens: 370ms`. A duration rather than a timestamp, so no clock-skew handling is
needed. Measured TPM for `llama-3.1-8b-instant` is **6,000**, which the published table does not
carry.

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
- **[#15](https://github.com/Jerome-Group/syrax/issues/15) (router design)** — the retry signal is
  per-provider and inconsistent: read headers on Cerebras and Groq, read the **error code** on Z.AI,
  and **count locally** on Gemini rather than probing. A uniform "429 means back off" rule is wrong
  on Z.AI, where 1302 is the expected steady state at concurrency 1 and means *retry in a second*.
- **[#25](https://github.com/Jerome-Group/syrax/issues/25) (quota awareness)** — the ticket's worry
  that a single percentage across incompatible meters is a lie is confirmed, and it is worse than it
  looked: three of five providers report nothing at all until they fail. The two units that actually
  exist are *requests against a daily cap* and *concurrent slots*, and only the first is reportable
  as a number that moves during the day.

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
