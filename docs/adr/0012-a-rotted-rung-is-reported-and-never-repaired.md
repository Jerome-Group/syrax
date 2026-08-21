# A rotted rung is reported, and never repaired by Syrax

A chain rung whose model has vanished is **detected, reported once, and removed only by the Owner**.
Syrax builds a reader for a signal the runtime already emits, plus a small sweep for the rungs that
signal cannot reach. It never chooses a replacement, and it never edits a chain on its own initiative.

This amends [ADR-0006](0006-the-runtime-routes-and-syrax-owns-the-escape-hatch.md), whose structure
survives untouched: the runtime's chains route, Syrax owns the hatch and the usage report, and
nothing here sits on the path a reply travels. What changes is that the report acquires a second
**subject** and a second **source**, and the third unit acquires a name that fits what it now does.

The problem is [#56](https://github.com/Jerome-Group/syrax/issues/56)'s parting finding: **model ids
rot faster than the decisions naming them.** Four named rungs went in a week, three inside 48 hours,
and Cerebras archived `zai-glm-4.7` **mid-session** — ninety minutes after it had served a tool call.
ADR-0006 reasoned carefully about quota and not at all about existence.

## The runtime already detects this; nothing reads it

The ticket that raised this assumed nothing surfaced a dead rung. That was wrong, and the correction
is the cheap half of the design. The pinned `openclaw@2026.6.34` emits a structured
`model_fallback_decision` warn carrying `requestedProvider`, `requestedModel`, `candidateProvider`,
`candidateModel`, `reason`, `status`, `code` and `lane`, and a dedicated human line — `Model
"<provider>/<model>" not found. Fell back to "<candidate>"`. A `model_not_found` is a first-class
failover reason with its own status mapping.

So the classification is already done, by the component best placed to do it, and Syrax builds a
**reader** rather than a classifier. Duplicate decisions coalesce on a 30-second window with a
suppressed count, which a unit poked on a calendar schedule never notices.

## A plain success is never logged, and that is what costs money

This is the finding the whole design turns on, and it is invisible from outside the package. The
emit is gated:

```
if (i > 0 || attempts.length > 0 || attemptedDuringCooldown) observeDecision({ decision: "candidate_succeeded", … })
```

The decision log speaks **only once something has already gone wrong**. A chain whose first rung
answers every turn writes nothing at all.

Restated as coverage, which is how it should be read:

| | Detected by the log |
|---|---|
| The currently-serving rung dies | Yes, on the very next turn |
| Any rung beneath it dies | **Never**, until the rung above it also fails |

Cerebras vanishing is caught within a turn. Groq vanishing while Cerebras is healthy is invisible
until the day Cerebras fails — which is precisely the day the rest of the chain is being relied on.
A passive reader alone is therefore guaranteed to be late exactly where lateness costs most, and
that is the entire justification for the next section.

## The sweep, and why it is a real request

Unreached rungs are checked by a **minimal completion each**, on the schedule launchd already uses to
poke the unit. Chain rungs only: front three plus worker four, so roughly seven requests a day at a
~10-token prompt. Against Cerebras' binding `tokens-day` rung — 1,000,000/day, which #56 measured as
**~80–160 turns** — that is about a thousandth of the day. Against a 500/day Flash Lite row, one of
500.

**A catalogue read would be cheaper and worse than nothing.** #56 measured both catalogues lying, and
in *both* directions: Z.AI's `GET /models` omits the free Flash models that work, and Cerebras' listed
one it had already archived. A free `GET` therefore produces false alarms **and** false silence, and a
detector that cries wolf and misses wolves is worse than no detector, because it is believed.

**The escape hatch is excluded**, and detected on use instead. Its rungs carry 20 requests a day
each, so one probe is 5% of that rung's day — the same arithmetic ADR-0006 used to make the hatch a
tool rather than a chain member. It already makes its own calls and already refuses before it spends,
so it observes its own 404s beside its counters, keeping the *sensor plus a refusal* shape
[#62](https://github.com/Jerome-Group/syrax/issues/62) confirmed.

**The runtime's own probe cannot do this job.** `openclaw models list --probe` exists and looks like
a free answer. It is not: `selectProbeModel` takes `candidates.get(provider)[0]` — **one model per
provider**, falling back to the first catalogue entry — so it is a credential probe, not a per-rung
existence check. It also runs a real completion of its own, and maps `model_not_found` into the
`"format"` bucket, collapsing a vanished model with a malformed request.

## Reported, never repaired — and the two are not one question

Syrax **never chooses a replacement.** ADR-0003's configuration contract and
[ADR-0007](0007-the-retrieval-loop-reports-and-never-retunes.md)'s report-only line both say so, but
the evidential argument is stronger than either: replacement needs a catalogue to choose from, and
the previous section established that neither catalogue can be trusted. This is not Syrax declining a
capability it has. It is Syrax declining to guess from a source already measured wrong.

**Removal is a different act and was weighed separately.** Taking a dead rung *out* needs no
catalogue at all, and [#45](https://github.com/Jerome-Group/syrax/issues/45) and #62 established the
actuator — a hot config write to `agents.defaults.model.fallbacks`, applied on a running gateway
~~with no restart~~ *(spent —
[ADR-0021](0021-a-config-write-is-applied-when-it-is-written-and-landed-when-a-channel-reloads.md))*.
So the cost of refusing removal is real: a dead first rung means every turn pays a round-trip until a
person acts.

It is still refused as an automatic act, for two reasons. A 404 cannot be distinguished from a
transient unrouting, so the evidence does not support an irreversible edit. And `CONTEXT.md`'s **stand
down** already names the hazard: a removal with no scheduled return is *"a rung retired by
accident"*, and a rotted rung has no reset to return at.

**So the report carries a tap.** [#53](https://github.com/Jerome-Group/syrax/issues/53) verified that
inline keyboards render inside a topic and that the callback carries `message_thread_id` — so the
Owner removing a rotted rung is one tap rather than hand-editing JSON on the mini. The actuator is
Syrax's and the decision is the Owner's, which is #62's asymmetry applied one level down. That is
what makes the refusal cheap instead of merely principled.

## The provider's own words, and the failure wearing the same status code

The report states the lane, the rung, what it fell back to, when it was last seen working, and **the
provider's message verbatim**.

This is what covers the quieter failure without a branch anticipating it. `z-ai/glm-4.7-flash:free`
did not 404 into silence — it 404'd with *the paid version is available now*, a rung that still
exists and has stopped being free, wearing the same reason code as one that is gone. A Syrax-side
taxonomy (`vanished` / `no longer free` / `renamed`) would have to be inferred from text each provider
writes differently and rewrites without notice, which is a classifier that decays exactly as fast as
the thing it classifies. Passing the message through unaltered is
[#13](https://github.com/Jerome-Group/syrax/issues/13)'s rule for the worker lane's output, applied
here.

## Once per transition, and the reader's own window

**Posted on transition, listed in between.** Alive→dead posts; dead→alive posts, because after #56 a
model reappearing is genuinely news. Between transitions the rung is *listed* in the on-demand report
and in the file, never re-announced — [#35](https://github.com/Jerome-Group/syrax/issues/35)'s shape
for pending entries. A daily post repeating a condition nobody has acted on is exactly what
[#25](https://github.com/Jerome-Group/syrax/issues/25) rejected: it trains the Owner to ignore the
report.

**The reader reports the window it actually covered**, not merely when it last ran. The runtime prunes
its own log at 24 hours and rotates at 100 MB across 5 files, so a unit poked daily sits on the edge
of the retention window. The reader keeps a byte offset; a log it cannot open, or a gap it can prove
it missed, is reported as *unknown* rather than as a quiet day.

That is ADR-0006's rule for silent providers turned on the reader itself — and it is the same
mitigation ADR-0006 accepted for coupling to the runtime's SQLite, now covering a second unversioned
internal surface on the same terms.

## What ADR-0006's SQLite source is worth today: nothing

Worth stating because the obvious question is why the log rather than the database. The runtime's
per-agent tables *would* carry this — `AUTH_FAILURE_REASONS` and `FAILURE_REASON_PRIORITY` both list
`model_not_found`. But they carry it through **auth profiles**, and #45 found none are created under
the inline-key shape, with
[ADR-0010](0010-one-secrets-store-reached-by-file-backed-refs.md)'s `apiKeyRef` shape not changing
that. The table exists and stays empty.

The log is the source because the database is not one.

## The third unit is renamed

ADR-0006's third unit is the **lane monitor**. It was the escape-hatch unit when the hatch was the
only thing it did; it now also reads the log, runs the sweep, and holds the last-read timestamps, so
the old name describes the smallest of three jobs. A reader asking *what watches the front lane*
would not think to open something called the escape-hatch unit, and that is the whole cost of a name.

The launchd label `com.jerome-group.syrax.hatch` is **unchanged** — renaming it would be a redeploy
for a word. This is vocabulary, and it lives in `CONTEXT.md`.

No fourth unit. ADR-0005's rule is one unit per resident thing that must exist exactly once, and a
byte offset and a sweep schedule are not such things.

## Consequences

- **A dead rung still costs a round-trip on every call that reaches it**, and this record does not
  fix that — it reports it. What makes that acceptable is measured rather than assumed: a 404 spends
  **no tokens**, so this is silent decay and not spend. Nothing skips the dead rung either —
  `fallback-skip-cache` covers `auth`/`auth_permanent` only, is disabled by default
  (`OPENCLAW_FALLBACK_SKIP_TTL_MS`, default `0`), caps at 10 minutes and dies with the process.
- **The sweep spends real requests to observe an absence**, seven a day forever, most of them
  returning nothing interesting. That is the price of the gating discovery above, and it is stated
  here rather than buried so that a later reader deleting the sweep knows what they are re-opening.
- **The log becomes a depended-upon interface.** It is internal, unversioned and outside the pin's
  contract, exactly like the SQLite coupling ADR-0006 accepted. This is a second such coupling,
  accepted on the same terms and with the same mitigation, and it makes
  [#71](https://github.com/Jerome-Group/syrax/issues/71) load-bearing rather than hygiene: the log's
  path is now something depended upon, and two rotators over one file would lose the window a reader
  is mid-way through.
- **The Owner is the repair mechanism.** If they do not read the report, the chain rots down to its
  last rung and then stops. The tap lowers the cost of acting; it does not remove the requirement.
- ADR-0006 is **not annotated**, because ADR-0001 makes a record immutable. This one names what it
  amends, as [ADR-0009](0009-the-chains-are-recomposed-and-stand-down-is-a-config-write.md) did
  before it.

## Revisit when

- **The runtime logs successful attempts, or exposes chain health directly.** The sweep exists solely
  because a healthy chain is silent. Either change deletes it outright.
- **A provider ships a catalogue that can be trusted.** Both the sweep's cost and the refusal to
  replace rest on #56's measurement that neither can. A trustworthy catalogue reopens both — the
  cheap detector first, and automatic replacement only after.
- **The tap goes unused.** If rotted rungs are reported and left, the report is not reaching the
  Owner, and the answer is a louder surface rather than a smarter one — up to and including
  reversing the *never repaired* half. Automatic removal is the reversal to reach for; automatic
  replacement is not.
- **The escape hatch stops being cold.** Its exclusion from the sweep rests on the same rare,
  human-invoked path ADR-0006's whole shape rests on, so this moves when that does.
- **The pin moves.** The gating condition, the log's shape, its retention and the coalescing window
  are all properties of `openclaw@2026.6.34` and none of them are contractual.
