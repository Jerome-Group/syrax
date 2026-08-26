# A rung the session has outgrown stands down until it can take it, and the call size is the rung's

Two things, and the second is why the first can be acted on. **The largest-call figure becomes a
property of a rung rather than of a lane**, and the lane monitor reconciles it against what real
traffic turns out to be. **A rung whose ceiling the current session cannot clear leaves its lane
until it can**, rather than being retried, compacted around, or deleted from the chain.

**This amends two.**
[ADR-0016](0016-the-lanes-are-recomposed-on-failure-rate-and-the-front-lane-is-told-not-to-guess.md)
loses the lane-wide figure its invariant read; the invariant itself is unchanged in shape and both
its terms stand. [ADR-0009](0009-the-chains-are-recomposed-and-stand-down-is-a-config-write.md)
loses *stand down is bounded by a stated reset* as the whole of what a stand down is; everything
structural about it — a config write plus a lander, a return that is owned, a guard against
emptying a lane — is untouched and is what the new kind reuses.

## The rung is not worthless, and that is what the decision turns on

Read from [#204](https://github.com/Jerome-Group/syrax/issues/204) alone, Groq's front rung looks
like a rung that cannot answer: 8,000 tokens per minute is also a per-request size ceiling, and a
**full** bucket — `x-ratelimit-remaining-tokens: 8000` — refuses `Requested 8098`. No amount of
waiting changes that.

The log says otherwise, and says when:

```
12:59:41  200   ← 12 real streaming turns
13:19:51  200   ← the last one
13:17:47  413   ← the first refusal
16:44:56  413   ← still refusing, 3½ hours later
```

Twelve served, thirty-seven refused, thirteen rate-limited. **A twenty-minute window in which the
rung worked, and then never again.** The rung answers a young session and dies as the session
grows, so its viability is a function of session state rather than of the rung. That is the whole
argument for standing it down rather than removing it: removal throws away something that works,
and it is the one act with nothing to bring it back (ADR-0012).

## Why backing off cannot work here, one step below the obvious

The obvious reading is that backoff is the right answer to a *rate* limit and the wrong one to a
*size* limit. True, and it is not the mechanism. The runtime's context-overflow detector
**deliberately returns false for any provider message naming tokens-per-minute** — a heuristic that
is correct for every provider whose TPM limit is only a rate. Groq's refusal names TPM, so the
detector rejects it before testing the twenty overflow signatures it would otherwise match, and the
error takes the rate-limit path. The live log carries the contradiction plainly: HTTP `413` with
`failoverReason: "rate_limit"`.

What follows is a retry loop that cannot converge, because **each retry appends the previous failure
to the session and is therefore larger than the attempt that just failed** — a measured +28 tokens
per retry, +112 per firing, monotonic for three hours.

That classification is the runtime's, it is
[reported upstream](https://github.com/openclaw/openclaw/issues/130096), and ADR-0003's division of
labour says it is not worked around here. It is stated because it is the reason a size refusal
arrives wearing a rate limit's clothes, and anything reading only the status code will keep waiting.

## Compaction was the alternative, and it loses on what it costs

The rejected option was to compact the conversation until it fits. It means **summarising the
Owner's chat in order to serve the worst rung in the chain** — paying a permanent quality cost, on
every turn, to keep a rung that is already at the bottom of the lane precisely because it is the one
we would rather not reach. Rerouting spends nothing at all while the better rungs answer.

Proactive compaction remains the floor and is untouched: the runtime compacts on a counted threshold
*before* the call, which is a different path from the error-driven one and is reachable. It is the
floor rather than the mechanism.

## The figure is the rung's, because one per lane cannot be contradicted

ADR-0016's invariant is right and the number it read was in the wrong place. A ceiling is the
**provider's**, strict on some and absent on others; a call is what reaches that provider. One
figure for a whole chain cannot say that a rung two positions down is asked something a different
size, and — this is the part that failed — cannot be corrected one rung at a time when the traffic
turns out to be larger than anybody wrote down.

The figure stays a **written constant**. That is what makes the invariant checkable before a gateway
comes up, which is most of its value. But a written constant that nothing reconciles is exactly how
this failed. The front lane's figure sat at **6,200** while #204 watched that lane's Groq rung
refuse a `Requested` of 8,631 rising to 9,359 — and this rung reserves 1,024, so the calls behind
those refusals ran from **7,607 to 8,335**. Every one of them was past the figure, and **the
invariant's own test stayed green throughout**, because it was checking the number in the file
against itself.

So the lane monitor reconciles. A refusal for size names the total the provider charged — prompt
plus reservation, unconditionally
([ADR-0034](0034-the-reservation-is-charged-whether-the-call-streams-or-not.md)) — so the call
behind it is that total less what the rung reserves, and a call larger than the written figure
means the check has been passing on a number the traffic left behind. It is reported **as a
configuration defect**, naming both numbers and the file to correct, rather than as a metric
nobody reads.

### What that reconciliation cannot do, stated rather than discovered

**It can only ever read a refusal.** A call that was served says nothing about its own size anywhere
in the runtime's log — there is no token count on a fallback-decision record, or on any record this
repository reads. So a stale figure is contradicted *after* a rung has already refused, never
before.

That is late. It is also later than never, which is what there was: the invariant stayed green
through every one of #204's thirty-seven refusals. A runtime that reported call sizes on success
would retire this limitation, and until one does, the honest reading is that the check catches the
second failure rather than the first.

## The stand down is a re-test, and calling it a reset would be a lie

A size stand down reuses ADR-0009's mechanism entirely: the same ledger, the same config write and
lander, the same guard refusing a lane's last rung. Reusing it rather than inventing a second
mechanism is deliberate — two ways for a rung to be missing from a chain is two things to reconcile
at startup, and the guard would have to be written twice.

What differs is what the bound **means**, and the entry says which it is rather than leaving a
reader to infer it from a timestamp. An allowance stand down comes back because the Owner's stated
reset arrived. A size stand down comes back **to be tried again**.

That distinction is forced by an absence: **nothing here can watch a session shrink.** There is no
session-size signal in the runtime's log, no scheduler that would carry one, and the rung is out of
the lane while it stands down, so it cannot observe its own way back. Putting it back and letting it
try is the only way to find out whether the Owner has reset the conversation. An hour is the
horizon, and the trade it makes is one refused call against the three growing retries a turn that
not standing it down costs.

**The re-test only means anything if the finding that caused it is spent.** The refusal is kept
while the rung is out — it is what the report lists, and correcting the figure is the thing the
Owner is being told to do — and it is dropped when the rung goes back. Keeping it past the return
would stand the rung down again on the next sweep off the same refusal, without the rung ever
having been tried, and the loop would look exactly like a rung that never comes back. A session
still too large writes a fresh refusal, and that is what stands it down again.

**A session-size signal would replace the horizon, and this record should be revisited rather than
patched when one exists.** Writing *returns when the session shrinks* while implementing *returns
after an hour to see whether it did* would be the kind of gap between a record and its code that
ADR-0001 exists to prevent.

## This widens the invariant, and the widening is the point

It stops being a check on **composition** — asked once, when the lanes are written — and becomes an
input to **membership**, asked against the session as it stands. That is a real change in what the
rule is for, and it is why this is a record rather than a refactor.

## ADR-0012's *reported, never repaired* is not being loosened

A size stand down is the monitor changing a chain without the Owner asking, which is the thing
ADR-0012 refuses. It refuses it on two grounds, and neither reaches here:

- **Ambiguous evidence.** ADR-0012's case is a 404 that cannot be told from a transient unrouting. A
  `413` naming its own `Limit` and `Requested` is not ambiguous; the provider has done the
  classification.
- **Irreversibility.** A removal has nothing to bring it back, which is why it is the Owner's. A
  stand down is written back by construction — that is what the record above insists a stand down
  *is*.

A rotted rung is still reported and never repaired, and removal is still the Owner's alone.

## Consequences

- **The lanes now hold seven copies of two numbers.** Every rung carries a figure and, today, every
  rung of a lane carries the same one. That is more to keep right than one per lane was, and the
  reconciliation above is the thing that makes it worth paying — a per-lane figure could not have
  been corrected for one rung without moving it for all of them.
- **A stale figure is found by a refusal, so the first one is always paid.** Stated above; repeated
  here because it is a cost rather than a limitation of the implementation.
- **An hour is a guess.** Nothing measured it. It is short enough that a reset session gets its rung
  back quickly and long enough that re-testing is cheap, and the first evidence either way should
  move it.
- **The Owner will see a rung leave a lane they did not touch.** The report says which kind and why,
  but this is the first membership change Syrax makes on its own, and *never dark, only slow* is now
  carrying one more thing that can take a rung out of a chain.
- **The written figures were not re-measured here.** They stay at ADR-0009's 6,200 and 5,239, which
  the front lane's traffic has already passed by 1,400 to 2,100 tokens — so the invariant is green
  against a number the monitor is expected to contradict on the first refusal. That is deliberate:
  #204's figures are refusals on one rung over one morning, and writing 8,335 into the file would
  state a ceiling measurement the traffic could pass again next week. What the monitor reports is
  what a correction should be made from.

## Revisit when

- **A session-size signal exists**, in the runtime's log or anywhere else. The re-test horizon is a
  stand-in for it and should not outlive it.
- **A served call's size becomes readable.** That moves the reconciliation from the second failure
  to before the first, which is where the invariant always claimed to be.
- **The runtime classifies a size refusal as one.** The upstream issue is open; if it lands, the
  chain fails over on its own and the stand down becomes an optimisation rather than a fix.
- **A rung stands down for size and never comes back.** That would mean the horizon is being met by
  a session nobody resets, and the answer is a session policy rather than a longer horizon.
- **Two rungs of one lane need genuinely different figures.** They do not today, and the whole
  argument for moving the figure was that they might. If they never do, the move bought only the
  reconciliation, and that is worth knowing.
