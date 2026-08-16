# The runtime routes, and Syrax owns the escape hatch

There is no provider router. The runtime's own fallback chains do the routing, and Syrax builds only
the two things the runtime cannot express: an **escape-hatch tool** that refuses before it spends,
and a **usage report** assembled from telemetry the runtime already collects. Neither sits on the
path a reply travels.

This reverses the recommendation in
[`provider-routing.md`](../research/provider-routing.md) — "route outside the runtime, in a
self-hosted OpenAI-compatible gateway process on the mini", with LiteLLM as the primary candidate.
That document is annotated rather than left readable as current advice.

## Why the research was reversed

The reversal is the interesting part of this record, because
[#7](https://github.com/Jerome-Group/syrax/issues/7)'s argument was **correct and was overruled on
cost, not refuted**. A reader who takes it as research nobody acted on has learned the wrong thing.

#7 argued that in-runtime routing fails structurally: cooldowns and quota memory live in one
process's memory, so every restart and every second consumer starts blind and rediscovers exhausted
providers by burning requests on 429s; and accounting fragments across entrypoints instead of
accumulating in one ledger.

All of that is true here, and measurably worse than #7 guessed — OpenClaw's failover state lives in
**per-agent** SQLite, so the four chats of
[#11](https://github.com/Jerome-Group/syrax/issues/11) each learn a provider's exhaustion
separately.

What changed is the price of being wrong. Rediscovery costs **one fast rejection**. Against Cerebras
that is 1 of 2,400 requests a day; against a Flash Lite lane member, 1 of 500. Against a **20-a-day
escape-hatch model it is 5% of the day** — and [#24](https://github.com/Jerome-Group/syrax/issues/24)
met that number directly when it declined to force a Gemini 429 to observe the payload, on cost
grounds.

So the expensive-to-probe case is not the hot path. It is the **cold, deliberate, human-invoked**
one: the escape hatch is reached only when the Owner asks for it in so many words. Buying a stateful
proxy, a third resident process and an extra hop on a front lane chosen for its ~3,000 tok/s, in
order to protect a path walked a handful of times a day, is the wrong trade. The cheap thing goes
where the cost actually is, and everywhere else one rejection is cheaper than the machinery that
would avoid it.

The premise that made #7's recommendation concrete had also gone. ADR-0003 records that OpenClaw
brings no usage or quota tracking but does bring ordered fallback chains;
[#14](https://github.com/Jerome-Group/syrax/issues/14) gave routing to the runtime;
[ADR-0005](0005-launchd-supervises-syrax-as-two-launchagents.md) provisioned two units with no router
among them; and [#25](https://github.com/Jerome-Group/syrax/issues/25) withdrew the LiteLLM
assumption explicitly, handing the decision *behaviour, not a product*.

## What the runtime already does, and the two things it cannot

**It handles transient failure well.** Its rate-limit classification is broader than HTTP 429 — it
matches provider *messages* such as "Too many concurrent requests", "quota limit exceeded" and
"resource exhausted" — and it treats auth failures, overload signals, transport failures and billing
disables as failover triggers too, while leaving malformed-request errors terminal rather than
retrying them. Nothing needs adding for this.

**It cannot express a daily rung.** Cooldowns are 30 s → 1 min → 5 min, capped, and not
user-configurable. A daily exhaustion is classified as a rate limit and gets the same treatment as a
per-minute stall, so there is no way to say *"this provider is done until the quota resets."* That
is the whole of what `CONTEXT.md` calls **stand down**.

**It offers no external way to remove a model from a chain.** No API, no file, no command resets a
cooldown or takes a model out of service from outside the runtime.

Those two absences are the entire justification for Syrax building anything here. Everything else is
configuration.

## The shape

**Two chains in the runtime's configuration, not three.** The front lane sits on the default model
setting and the worker lane on the sub-agent override.
[#13](https://github.com/Jerome-Group/syrax/issues/13)'s three-lane table will otherwise read as
three configuration entries, and it is not one.

**The escape hatch is a tool, not a chain.** It holds **five** counters — one per rung of the
version ladder, each model row carrying its own 20-a-day allowance — and refuses before spending
anything, which a chain member cannot do. This is #13's own move applied one level down: it made the
worker lane a sub-agent called as a tool rather than a fallback tier, and the same reasoning makes
the hatch a tool rather than a chain. A tool can say *"two hatch calls left today, still want
it?"*; a chain member can only 429.

The hatch stays a **lane** in the glossary's sense — a named set of models reached by role — but
nothing in the runtime walks it. The two Flash Lite rows at 500 a day are **not** counted: they are
ordinary chain members, cheap to probe, and they belong to the runtime.

**Telemetry is read, never intercepted.** Providers that report — six rungs on every response from
one, reset durations from another, a key endpoint on a third — do so on calls the runtime is making
anyway, and the numbers land in its own state. Syrax reads, caches and timestamps them. Nothing is
added to the request path.

Per-chat visibility falls out of this for free. #13 promised it through one virtual key per chat,
which was a LiteLLM feature; a chat *is* an agent here, and the runtime's usage stats are already
per-agent. **The mechanism is withdrawn and the requirement is met** — the same fragmentation that
makes cooldowns worse is what makes visibility free.

## The hatch is its own unit

ADR-0005 made the search service standalone because the default MCP transport would have given four
agents four resident embedders, and stated the rule that implies: **one unit per resident thing that
must exist exactly once.** The hatch's counters are such a thing. They are also nothing like the
search service in weight — a counter and an HTTP call against a 300 MB index and a resident model.

Bundling them would mean an embedder restart clearing the hatch's counters, which is a silent way to
hand back an allowance that has already been spent. So the hatch is a third
`com.jerome-group.syrax.*` unit, and it is the unit that writes the report file, with launchd poking
it to refresh — keeping ADR-0005's single auditable answer to *what can message me unprompted*.

## Coupling to the runtime's internal state, accepted

Reading the runtime's per-agent database is reaching into **internal, unversioned state**, and
ADR-0003's pin is meant to roll forward. A schema change upstream breaks the report — and breaks it
**silently**, which is the worst shape available, because a stale report is indistinguishable from a
quiet day.

Accepted deliberately, with one requirement that makes it survivable: **the report states when it
last successfully read each source.** An unreadable database surfaces as *unknown*, never as
*nothing moved*. That is #25's own rule for providers that report nothing, turned on the reader
itself.

## The two overrides are asymmetric

They read as a matched pair in #25 and they are not one, which is worth stating plainly so that
nobody goes looking for the half that does not exist.

- **Pin is native and free.** The runtime has a session command that forces a model and persists
  across restarts.
- **Stand down has no mechanism at all.** It is a configuration change plus a unit restart, surfaced
  as a System-chat action. It drops in-flight turns, which is acceptable for what #25 described as
  manual repair of a provider misbehaving in a way no counter can see — and ADR-0005 made restarts
  routine and `KeepAlive` makes them safe.

## Pre-emptive switching is narrower than it was specified

Under this design nothing acts on telemetry ahead of a call **except the hatch**. Every other lane
is reactive: the runtime fails over when a provider refuses.

That is a choice, not an omission, and it follows from the cost argument above. `CONTEXT.md`'s
**pre-emptive switch** entry was written to say so — the term is reserved for where being refused is
expensive, and withheld where a refusal costs one call.

## The limitation this design accepts

**The runtime cannot tell Z.AI's `1302` from its `1308`.** #24 measured the body as
`{"error":{"code":"1302","message":"Rate limit reached for requests"}}`, and the runtime matches the
**message**, not the code. So the *normal steady state* of the worker lane's floor provider — the
one member with no token ceiling, the reason the system degrades to slow rather than to off — reads
to it as a rate limit. It will fail over to a finite provider and cool the unmetered one down for
30 s, escalating to 5 minutes. #24's carefully-measured code table, the distinction it said this
decision needed, cannot be acted on inside the runtime.

**The response is to prevent the overlap rather than handle the rejection.** `1302` fires on
*concurrent* calls; a single sequential worker turn at concurrency 1 never trips it. The overlap
sources are enumerable and small — the morning brief against a live chat turn, or two chats wanting
the worker at once — and ADR-0005 put every schedule under launchd, so their timing is ours to move.
One overlap costs 30 seconds of the floor provider and one call from a 500-a-day bucket. A queue in
front of the lane, which #13 already named as the fix if it ever bites, would grow the hatch unit
into a worker gateway and arrive at the architecture this record just rejected.

So **Syrax reads the code for the report and does not route on it.**

This rests on **inferring the runtime's classifier from its documentation rather than measuring it**,
and that documentation describes current OpenClaw while ADR-0003 pins an exact version.
[#45](https://github.com/Jerome-Group/syrax/issues/45) verifies it against the pin. If the
classification turns out otherwise, this section is what changes.

## Where the deadlines live

[#25](https://github.com/Jerome-Group/syrax/issues/25)'s last behaviour — time since the last token
per lane, a whole-turn ceiling above it, two recovery attempts — **cannot live in a router under any
shape**, because a turn is an agent-loop concept a proxy never sees. The front agent owns the
whole-turn ceiling because it owns the message; the worker's stall deadline is the sub-agent tool's
own timeout.

Recorded here mainly so it does not read as a requirement the router was supposed to absorb and
quietly dropped.

## Consequences

- `docs/research/provider-routing.md` is annotated where its recommendation was reversed, following
  the precedent #24 set with `free-token-providers.md`. Research is dated evidence, and a document
  left readable as current advice is how a later session rebuilds a rejected design.
- `docs/configuration.md` gains the third unit and the report file's path.
- The glossary gains **router**, defined as a behaviour rather than a component — the counterpart to
  ADR-0005's **gateway**, which is the collision that made both entries necessary.
- [#39](https://github.com/Jerome-Group/syrax/issues/39) does not block this. It decides whether lane
  *selection* is agent-level or chain-level, which is #13's decision to lose; this record decides
  where daily-quota state lives, and the answer is the same under either shape.

## Revisit when

- **The runtime makes cooldowns configurable, or exposes a way to remove a model from a chain.**
  Both absences are load-bearing here — the first is why a daily rung cannot be expressed, the second
  is why stand down is a restart. Either one appearing reopens the shape.
- **The escape hatch stops being cold.** The whole argument rests on the expensive-to-probe path
  being human-invoked and rare. If it is reached routinely, a gate on a hot path is a different
  trade and an external router returns to contention.
- **The floor provider publishes a daily ceiling.** #24 found none, which is what makes it the
  never-dark floor and what makes `1302` its steady state. A ceiling would give it a boundary to
  reset on and turn the accepted limitation above into a real one.
- **A schema change upstream breaks the telemetry read.** Expected eventually rather than feared;
  the last-read timestamp is what makes it visible when it happens.
- **#45 contradicts the inferred classification**, which would reach the limitation section directly.
