# The rationed lane's rungs are measured, and there are four

[ADR-0006](0006-the-runtime-routes-and-syrax-owns-the-escape-hatch.md) counted **five** rungs on the
version ladder and [ADR-0009](0009-the-chains-are-recomposed-and-stand-down-is-a-config-write.md)
carried the number forward. Measured on the account, the ladder is **four**, and the number was
never a decision to make: it is a property of the provider, which is the half of this record that
outlives the count.

Nothing structural moves. The hatch is still a tool that refuses before it spends, its counters are
still per rung, and it still sits in no chain.

## What the account says

Measured 2026-08-24 for [#127](https://github.com/Jerome-Group/syrax/issues/127), at a cost of
fifteen requests out of the day's eighty. The catalogue lists seven Flash rows once the lite, image,
audio and omni variants are set aside; four of them are the lane.

| Row | One minimal completion | What it is |
|---|---|---|
| `gemini-3.7-flash` | 200 | a rung |
| `gemini-3.6-flash` | 200 | a rung |
| `gemini-3.5-flash` | 200 | a rung |
| `gemini-3-flash-preview` | 200 | a rung |
| `gemini-flash-latest` | 200 | an alias of 3.7 |
| `gemini-2.5-flash` | **404** | listed, and gone |

**The alias is measured rather than assumed**, because assuming it is how a counter with no
allowance gets written. Seven rapid calls to `gemini-flash-latest` were refused on the fifth —
`Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests,
limit: 5` — and `gemini-3.7-flash` was refused in the same minute while `gemini-3.5-flash` and
`gemini-3-flash-preview` both answered `200`. One bucket wearing two names, and buckets that are per
model, which is [#94](https://github.com/Jerome-Group/syrax/issues/94)'s finding for Flash Lite
holding on Flash.

**`gemini-2.5-flash` is the catalogue lying in the direction
[#56](https://github.com/Jerome-Group/syrax/issues/56) measured**, and it says so itself: *"This
model models/gemini-2.5-flash is no longer available to new users. Please update your code to use
models/gemini-3.6-flash."* Its Flash Lite sibling went the same way in #94. So ADR-0006's five was
right when it was written and one row has since been withdrawn — this is the provider moving, not a
record that was wrong.

## The count is not the decision

The decision is where the count comes from. **A row joins the rationed lane only once it has
answered and its neighbours have been probed in the same minute**, and never because a catalogue
lists it or a version number suggests it should exist. Both failure directions are already measured
here: the catalogue offers a row that 404s, and it offers a second name for a row already in the
lane. A counter against either is worse than no counter, because the hatch would report an allowance
that is not there and refuse a day later than it should.

So the count lives in `src/adapter/hatch-lane.ts` and nowhere else. The counters are read from that
composition rather than from a number written beside them, which is what makes a fifth row — if one
is ever measured — one entry and no code change. **This record does not restate the count as a
decision**, because a record that carries a number the provider owns is a record that will be wrong
again on the provider's schedule rather than on ours.

## Why this is a record rather than a note in the research file

The measurement belongs in `docs/research/free-tier-limits.md`, and it is there. What belongs here
is the thing a session cannot get from the measurement: **the five is load-bearing in two records
and in a ticket's acceptance criteria**, so a session reading ADR-0006 today and finding four rungs
in the code reads it as an implementation that fell short. It would add the two missing names, and
both of them are wrong — one gone, one an alias.

## Consequences

- **The hatch's day is 80 requests, not 100.** Every arithmetic in ADR-0006 that reasons about *5%
  of a rung's day* is unchanged, because it is per rung and each rung still carries 20.
- **The ladder will shrink again**, silently, in the way #56 named: a row is withdrawn and the hatch
  discovers it at the moment the Owner asks for it. That is where it is discovered by design —
  ADR-0012 excluded the hatch from the daily sweep on the same 5%-of-a-day arithmetic, and the hatch
  observes its own 404s beside its counters instead.
- **Re-measuring costs what this cost**: fifteen requests, most of them spent proving the alias. It
  is not a check anything runs on a schedule, and this record is what a later session compares
  against rather than a baseline it has to re-derive.
- **ADR-0006's and ADR-0009's counts are marked in place**, under
  [ADR-0018](0018-a-spent-claim-in-an-adr-body-is-marked-in-place.md), with the parenthetical alone:
  both were right when written.

## Revisit when

- **A Flash version appears or disappears.** Either moves the count, and the rule above is what says
  what to do about it: probe before it is written down.
- **A rung 404s in use.** The provider's own sentence is what distinguishes a withdrawal from a
  transient unrouting, and ADR-0012's *reported, never repaired* is what happens next.
- **Gemini states a remaining allowance anywhere on a successful call.** The whole of the local
  counting rests on it reporting nothing, and a header would move Gemini into the group the report
  reads rather than counts.
