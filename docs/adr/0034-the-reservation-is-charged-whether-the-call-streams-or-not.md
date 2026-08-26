# The reservation is charged whether the call streams or not, so not streaming is no escape

[ADR-0016](0016-the-lanes-are-recomposed-on-failure-rate-and-the-front-lane-is-told-not-to-guess.md)'s
invariant reads a request as its prompt **plus that rung's own `maxTokens`**, and it argued that
second term from a streaming call. **This record removes the condition, and nothing else.** The
invariant stands, both its terms stand, and every rung sits where ADR-0016 put it. What changes is
that a session may no longer reach for `stream: false` when a rung refuses a call for its size —
because that was the one thing the old wording offered and it does not work.

**This amends ADR-0016 in one part**, its supporting claim rather than its decision. ADR-0008's
separate decision that the front lane does not stream is untouched: it rests on availability, and
it was never an argument about walls.

## What was claimed, and what the provider does

ADR-0016 wrote it as a property of streaming:

> On Groq a **streaming** request is charged its prompt **plus the output it reserves** … and the
> identical call sent without streaming was not refused at all. OpenClaw streams.

Measured against the live provider on the pinned model, `stream: false` throughout:

- **The reservation is debited without streaming.** A 3,598-token prompt reserving 128 output
  tokens left `x-ratelimit-remaining-tokens: 4274` against a limit of 8,000. 8000 − 4274 = 3726 =
  3598 + 128, exactly. The reservation is debited whether or not it is used.
- **The refusal happens without streaming.** The same prompt reserving 4,500 was refused `413`,
  `Requested 8098`, against a bucket reporting `x-ratelimit-remaining-tokens: 8000` — a **full**
  bucket, so the refusal is about size alone and not about what was left.

The evidence is [#204](https://github.com/Jerome-Group/syrax/issues/204)'s
[triage measurement](https://github.com/Jerome-Group/syrax/issues/204#issuecomment-5423918213),
taken on the same key and the same model ADR-0016 measured.

So the two-term sum is right and the condition on it is wrong. `stream` is not a term.

## The older observation is left unreconciled rather than explained away

ADR-0016's exemption is not an inference — somebody sent that call and got a 200 back, and
`docs/research/free-tier-limits.md` records it a second time as *"the same request with
`max_tokens: 8192` **not** streaming returns 200"*. The streaming form of that same request is
recorded in both places as `Limit 8000, Requested 10931`, so under the arithmetic above the
non-streaming one should have been refused outright too.

**One of the two runs saw something the other did not, and this record does not say which.** It has
not been re-run: the original was a bare `curl` whose exact body is not preserved, and reproducing a
200 that should not exist is not the same as reproducing a refusal. What is measured is what is
written above, and it is enough to spend the claim, because a rule stated as *streaming is what does
this* is falsified by one non-streaming request that does it.

This is the same disposition ADR-0016 itself took to #56's 6,141-token call, and for the same
reason: *"a tidy story here would be invented rather than measured."*

## Why this is worth a record rather than a correction in place

The three artefacts carrying the claim can simply be corrected — the glossary and a field comment
are working text, and ADR-0016's own body is marked rather than rewritten
([ADR-0018](0018-a-spent-claim-in-an-adr-body-is-marked-in-place.md)). None of that needs a
decision. What needs one is the **escape hatch the old wording implied**, because it is the thing a
future session will reach for.

A rung refusing a call for its size presents exactly like a rung refusing it for its rate, and the
old wording offered a free fix: turn streaming off and the wall goes away. It would have been tried
under time pressure, by a session reading a glossary entry rather than a provider's headers, and it
would have cost a round of configuration and a deployment to learn nothing. Writing *the condition
was false* somewhere a reader arrives is what stops that, and a glossary entry with the clause
deleted says nothing at all to a reader who remembers it.

## Consequences

- **A wall now has exactly one lever, and it is `maxTokens`.** Both terms of the invariant are
  Syrax's to set, but the prompt is what the conversation is and the reservation is what the
  configuration says — so a rung that will not fit is a reservation to change or a rung to stand
  down, and there is no third option. That is a narrower world than ADR-0016 described.
- **ADR-0008's decision is now the only reason the front lane does not stream, and it always was.**
  ADR-0016 struck its value argument and left it standing on availability; this removes an argument
  it never made but that a reader could have credited it with.
- **One measurement stays unexplained**, and it is recorded above rather than resolved. A later
  session that reproduces a large non-streaming reservation clearing an 8,000 ceiling has found
  something this record could not, and should say so.
- **Nothing in the lanes moves.** No rung's `maxTokens`, no ordering, no ceiling. This record
  changes what is *believed* about a charge that both lanes were already composed against.

## Revisit when

- **A provider is added whose reservation is not debited.** The invariant's second term is measured
  on Groq and on nothing else; a rung that publishes a per-request ceiling and charges only what it
  generates makes the sum wrong in the other direction, and over-reserving would cost nothing there.
- **The pinned runtime stops streaming, or gains a way not to.** The condition being false is what
  makes that a non-event; if it were ever true again, this record is what would have to move.
- **The unreconciled 200 reproduces.** That is the one result that would put a condition back on the
  charge, and it would need a preserved request body rather than a recollection.
