# The chains are re-composed, and a stand down is a config write

[ADR-0006](0006-the-runtime-routes-and-syrax-owns-the-escape-hatch.md)'s structure is untouched: the
runtime's own chains route, Syrax owns the escape hatch and the usage report, and neither sits on
the path a reply travels. What this record amends is everything hanging off that structure — which
models sit in which lane, whether a lane may refuse before it is refused, and how a stand down is
actuated.

It amends ADR-0006 once rather than three times. Three tickets fired at the same record within a
week — [#56](https://github.com/Jerome-Group/syrax/issues/56) measured every rung against the pinned
runtime, [#60](https://github.com/Jerome-Group/syrax/issues/60) asked whether lane selection may
pre-empt, and [#62](https://github.com/Jerome-Group/syrax/issues/62) asked what changes now that a
stand down needs no restart. Three amendments to one ADR in one week is a record nobody can read.

## The chains ADR-0006 composed do not survive contact

Every rung put to the pinned `openclaw@2026.6.34` on 2026-08-18, against the two call sizes that
turned out to decide everything: **6,115** prompt tokens for a simple front turn, and
**13,200–13,431** for a sub-agent's *first* call — larger than the entire front-lane turn that
spawned it, because sub-agents carry their own tool schemas and the schemas dominate.

| Lane | ADR-0006 | Measured composition |
|---|---|---|
| front | Cerebras → Groq → Gemini 3.5 Flash Lite | Cerebras → **Gemini 3.5 Flash Lite** → Groq |
| worker | Z.AI → Gemini 3.1 FL → OpenRouter `:free` → Groq | **Z.AI `glm-4.5-flash`** → Gemini 3.1 FL → Z.AI `glm-4.7-flash` → OpenRouter `openai/gpt-oss-20b:free` |

The revised composition ran end to end — a delegating turn *including a front-lane failover* — in
**2.9 s**. Neither #39 nor #45 ever got a chain to do that, which discharges #39's closing finding
that no rung of these chains had ever carried a real turn.

### Groq leaves the worker lane permanently

This is the load-bearing half. Groq's 8,000 TPM bounds the **single request** as well as the minute,
so the 13.2K sub-agent call was refused `413 Request too large` **with the bucket reporting a full
8,000 remaining**. It is not a quota that refills at midnight or on the minute. Four retries were
refused at 13,200, 13,277, 13,354 and 13,431 tokens, each carrying a little more context than the
last.

No prompt cut reaches it. #56's own premise was *decide the prompt budget first or you measure a
number Syrax picked by accident*; the budget was decided, and after a 49% cut the sub-agent call is
still 65% over.

### Groq is demoted rather than removed on the front, and the argument is latency

It carries a simple turn under the ceiling. It survives a *delegating* one only by **retrying in
place** — the runtime logs no fallback decision at all — turning an 8.9 s turn into **40.4 s**
against a rung that answers in 1.1 s. A rung that degrades the one property the front lane exists
for belongs below the rung that does not.

### Z.AI is kept and re-modelled

`1305` is neither #39's wall nor #45's window: twenty sequential calls, `glm-4.7-flash` answered
**3**, refusing a 160-token request and serving a 6,458-token one inside the same minute. There is no
outage to wait out and no recovery to detect.

**And it is per model.** `glm-4.5-flash`, same key, same twenty calls, answered **20 of 20** at a
0.68 s median. *Service temporarily overloaded* names a model's capacity, not a provider's — so a
router reading only the code would stand down a provider that has a perfectly good free model on it.
The floor holds, on a different model from the one it was written about, and `glm-4.7-flash` stays as
a rung beneath it rather than above.

### The OpenRouter rung ADR-0006 names does not exist

`z-ai/glm-4.7-flash:free` answers `404 … The paid version is available now`. Its replacement
tool-calls on a small request but failed a real sub-agent turn on upstream capacity (*queue timeout*,
classified `timeout` rather than `rate_limit`), so it is recorded as a **tail rather than a lane**.

### Cerebras binds on tokens-day, not requests-day

Every prompt token is charged on every call, cached ones included. At the measured turn costs,
1,000,000 tokens/day is **~80–160 turns**, where the 2,400 requests/day rung suggested an order of
magnitude more — so every earlier ticket reasoning about Cerebras in requests overstated it by
15–30×. This is what makes prompt size a capacity decision rather than tidiness, and it is why the
number worth reporting for Cerebras is tokens remaining rather than requests.

## The lanes stay reactive, and the reason is not the obvious one

The question was whether a lane should skip a rung it can predict will refuse. It turns on whether
any rung is *sometimes viable*, and answering it needed a distinction the record did not carry:
**#56's two Groq failures are two different things.**

| | Status | `retry-after` | Waiting helps? |
|---|---|---|---|
| **Wall** — requested > limit | **413** | `65` | **Never** |
| **Bucket** — requested > remaining | **429** | `4` | Yes |

Both carry `"type": "tokens"` and `"code": "rate_limit_exceeded"`. **The code separates nothing** —
the status and the wording do, which is one more instance of #45's finding that the runtime
classifies at the status before the code is consulted. So the worker lane's `413 ×4` is the wall and
the front lane's 40.4 s is the bucket, that 40.4 s being the measured ~41 s token reset rather than
anything about Groq.

**The wall sends a `retry-after` it cannot honour.** Sixty-five seconds of waiting does not make an
11,088-token request fit an 8,000-token ceiling — which is exactly why the worker lane retried four
times against a condition no retry could satisfy, and why anything reading the header alone takes a
wall for a bucket forever.

That splits the question in two. The **wall is arithmetic**, knowable locally with no network. The
**bucket is quota state**, knowable only by asking — which is ADR-0006's argument untouched.

Checked against all six providers, **Groq's 8,000 is the only ceiling that falls between a 6.2K front
call and a 13.4K worker one, and it falls exactly on the lane boundary**: everything the front sends
clears it, nothing the worker sends ever will. #56 having already removed it from the worker chain,
**the arithmetic case has no live instance left**, and the one rung that came closest is sometimes
viable *across* lanes rather than within one — which is a statement about membership, and membership
is configuration.

So the answer is **reactive, answered in chain composition**. The ~0.4 s-per-skipped-rung trade the
question was framed on is deliberately *not* recorded as the reason: recording it that way is what
would bring the question back a third time. The reason is that the only locally-knowable failure is a
property of a rung's membership in a lane.

### The invariant this makes load-bearing

Composition now carries the answer, and nothing checks it — Groq was caught by measuring, and the
next rung will be added by someone reading a table. Stated as a number rather than as prose:

> **A rung's per-request token ceiling must exceed the largest single call its lane makes: ~6.2K on
> the front, ~13.4K on the worker.**

Deliberately **not** a check the escape-hatch unit runs. It would be real work for a failure that
surfaces on the first turn against a new rung, and
[#68](https://github.com/Jerome-Group/syrax/issues/68) already owns *a rung has silently gone*.

### Pre-emption is widened on one axis and closed on the other

ADR-0006 narrowed pre-emptive switching to the escape hatch alone, reasoning that elsewhere a
rediscovery costs one rejection out of 2,400. Against Cerebras' **tokens-day** rung that is wrong by
an order of magnitude: at ~80–160 turns a day, rediscovering exhaustion costs **0.6–1.25% of the
day**.

It qualifies without touching the request path, because every piece already exists — Cerebras reports
all six rungs on every success (and nothing when it refuses), the usage report already reads them,
`agents.defaults.model.fallbacks` hot-applies, and the reserve is already fixed rather than a
percentage. So the narrowing widens **from the hatch alone to the hatch plus any rung whose binding
limit is tokens-per-day**, and the shape is unchanged: a pre-emptive switch is a *daily-rung,
off-path stand down*, and never a per-request filter.

## A stand down is a config write, and the asymmetry was on the wrong axis

#45 fired ADR-0006's first *revisit when* trigger by taking a model out of a chain from outside the
runtime, with no restart — `config set agents.defaults.model.fallbacks` hot-applied on a running
gateway, same process id, live on the next turn.

The answer turns on a separation the question ran together. **ADR-0006 made two arguments and #45
killed exactly one:**

| Argument | Whose | Status |
|---|---|---|
| *it cannot express a daily rung — no way to say **this provider is done until the quota resets*** | **stand down**'s | **Dead.** A config write states it exactly. |
| *refuses before spending anything, **which a chain member cannot do*** | the **hatch**'s | **Untouched.** |

The hot-apply is a new **actuator**; the hatch is a **sensor plus a refusal**. It has to *know*
Gemini is spent, and Gemini is the one provider that reports nothing at all — which is precisely why
a local counter was kept for Gemini alone. Then it has to decline *before* spending 5% of the day,
where a chain member can only 429. And the hatch sits in no chain, so there is no membership for a
config write to remove. **Five per-rung counters survive unchanged, and the hatch stays its own
unit**: removal-after-you-know does not substitute for refuse-before-you-spend.

**Stand down and pin still do not collapse**, but ADR-0006's asymmetry was recorded on the wrong
axis. It made them asymmetric on *cost* — pin native and free, stand down having no mechanism at all
— and that is dead. They were never inverses:

- **Pin overrides *selection*** within the configured chain, and belongs to **the runtime**.
- **Stand down overrides *membership*** of the chain, and belongs to **Syrax**.

Two consequences. **Stand down no longer drops in-flight turns**, so ADR-0006's paragraph excusing
that cost is retired rather than amended. And — the one that outlives the correction — **a config
write has no expiry.** A cooldown lapses by itself; a stood-down rung returns only when something
writes it back at the reset it was stood down until. The return is owned rather than awaited, and a
stand down with no return scheduled is a rung retired by accident.

### The write lands in `openclaw.json`, reconciled at startup

That file is already machine-touched, and the runtime maintains a `.last-good` sidecar with guards
against destructive writes. The real hazard is not the file: it is **a redeploy from the authored
contract silently reverting a live stand down, or silently restoring a stale one** —
[#11](https://github.com/Jerome-Group/syrax/issues/11)'s topic problem in another costume, and it
takes the same answer. **Stand downs are Syrax's state, re-derived from the counters at startup**,
never inherited from whatever the config file happened to say.

**`$include` was considered and rejected on the record.** The pinned version's own documentation
describes write-through for a single-file include, but the smallest top-level section holding both
chains is `agents` — front on `agents.defaults.model.fallbacks`, worker on the subagent override — so
the split would make the *entire* agents section generated, including the per-chat definitions that
are the substance of ADR-0003's configuration contract. It buys localisation at the price of a rule
that **fails closed** on include arrays, root includes and includes with sibling overrides, which is
a silent way for a stand down to stop working.

## *Never dark, only slow* is a claim about allowance, and only allowance

#45 **strengthens** the guarantee's mechanism: a cooled-down rung is **probed, not skipped** — with
6.8 s left on a live cooldown the next turn succeeded on the cooled-down provider — so a `1302`
costs one rejection on the turn that was refused and does not take the unmetered floor out of
service. ADR-0006's *"cool the unmetered one down for 30 s, escalating to 5 minutes"* is **struck**:
the ladder never left its first 30 s rung at error counts of 4, 6 or 7, and the runtime's own shipped
documentation disagrees with its code on this.

What replaces the guarantee is narrower and honest. Z.AI publishes no token or daily ceiling, so **no
lane runs out of allowance**, and that much holds. But #39's *wall*, #45's *window* and #56's *85%
rejection rate* are three readings of **capacity** — a provider with headroom to spare refusing
because it is busy — and it is not Z.AI's alone: Cerebras answers `queue_exceeded` with
`x-should-retry: false` and **no rate-limit headers at all**, on the front lane, exactly when the
report needs them.

**The guarantee is *never dark for want of allowance*. Capacity is the uncovered axis, and it is
stated rather than mitigated** — it has no quantity to count and no header to read. No new term is
earned: `headroom`'s *unknown rather than full* carries it.

**The overlap mitigation is kept and its justification struck.** launchd owns every schedule, so
spacing them stays free — but it saves one wasted call rather than preventing an outage.

## Consequences

- The composition is correct on 2026-08-18 and will not stay correct. Four named rungs went during
  #56's session, three inside 48 hours, and Cerebras archived one **mid-session** ninety minutes
  after it served a tool call. This record patches the composition once; #68 is the standing version
  of that problem.
- The invariant is a rule with no enforcement. It holds only for as long as whoever adds a rung reads
  it, and its failure surfaces as a lane that refuses every delegating turn.
- Anything Syrax writes that talks to Cerebras or Groq directly needs a **normal User-Agent** — both
  sit behind Cloudflare, which answers `403 error code: 1010` to `Python-urllib`, so a working key
  looks like a dead one.
- Gemini Flash Lite's 500/day is carried from a published page and **was not re-verified** —
  confirming it costs 500 requests — and it is now load-bearing on two lanes rather than one.
- Mistral is provisioned and is **not a front-lane rung at any token allowance**: 48–109 tok/s against
  Cerebras' ~3,000. Its width would clear the worker lane's wall with room, and that re-read is
  available whenever the worker lane is next opened.

## Revisit when

- **A rung enters a lane whose ceiling falls between that lane's smallest and largest call.** The
  sometimes-viable rung that does not exist today, and the one thing that would genuinely change the
  reactive answer. Checkable in one comparison against the invariant.
- **The prompt budget moves a lane's largest call across a rung's ceiling** — that number is
  ADR-0011's and can move it in either direction.
- **OpenClaw gains per-request chain filtering**, which would make pre-emption expressible without a
  component on the request path.
- **The runtime gains its own daily-quota accounting, or a way to refuse a call before making it** —
  either takes the hatch's remaining justification, which is now solely *refuse before spending*.
  This replaces ADR-0006's first trigger, whose second half has fired and whose first half is
  confirmed absent and no longer load-bearing.
- **A stand down is left un-returned.** The return is owned rather than automatic, so this failure is
  silent by construction.
