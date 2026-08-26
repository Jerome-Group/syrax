# The lanes are re-composed on failure rate, and the front lane is told not to guess

> **Amended by [ADR-0034](0034-the-reservation-is-charged-whether-the-call-streams-or-not.md) in
> one part.** A request is charged the same way whether it streams or not, so *"the identical call
> sent without streaming was not refused at all"* is false and not streaming is no escape from a
> wall. Both terms of the invariant, the composition, and every rung's `maxTokens` are untouched.

The front lane is **Gemini 3.5 Flash Lite → Mistral `ministral-3b-latest` → Groq
`openai/gpt-oss-120b`**. The worker lane is **Gemini 3.1 Flash Lite → Mistral
`ministral-8b-latest` → Groq `openai/gpt-oss-20b` → Z.AI `glm-4.5-flash`**. No model appears in
both. Two settings become configuration Syrax states rather than inherits: a per-model `maxTokens`,
and a standing instruction telling the front lane not to assert what it has not checked.

Cerebras is gone — it had no free tier and never did, and the `$5` trial balance that had been
paying for everything ran out. The measurements are
[#94](https://github.com/Jerome-Group/syrax/issues/94)'s and are not repeated here;
[its resolution comment](https://github.com/Jerome-Group/syrax/issues/94#issuecomment-5349870244)
is the evidence this record argues from, and `docs/research/free-tier-limits.md` carries the tables.

**This record amends three, and amends each once.**
[ADR-0009](0009-the-chains-are-recomposed-and-stand-down-is-a-config-write.md) loses its
composition and its invariant, [ADR-0008](0008-the-front-lane-does-not-stream.md) loses one of its
two arguments, and [ADR-0011](0011-the-front-lane-carries-no-skills-and-a-pinned-workspace.md)
loses the premise that the workspace is empty. ADR-0009 was itself written to amend ADR-0006 once
rather than three times, on the grounds that three amendments to one record in a week is a record
nobody can read; the same reasoning produces one record here rather than three.

## Speed stopped being the question, which is why the answer moved

Every earlier composition was argued on speed, and reasonably: Cerebras at ~3,000 tok/s was an
order of magnitude clear of everything else, so the fastest rung was obviously the top rung. With
Cerebras gone, **six free candidates answer a terse turn inside 0.86–1.09 s** — a spread far
smaller than the cost of a single rate-limit stall. Speed still chooses the shortlist. It cannot
choose within it.

So the ordering criterion changes, and it is worth stating plainly because it is what makes this
composition look wrong to anyone still reading the old records: **the shortlist is chosen on
latency and the rung is chosen on failure rate.** The Owner set that order directly.

That criterion is what reverses ADR-0009's categorical that Mistral is *"not a front-lane rung at
any token allowance"*. The judgement was sound on the axis it used — generation throughput — and
the front lane's replies are terse, where throughput barely shows. On the axis that decides a
conversation, `ministral-3b-latest` answers as fast as anything free and is the only candidate
whose allowance a single user cannot exhaust. The categorical is withdrawn; the measurement behind
it stands, and is why Mistral still loses the expanded-reply case.

The same criterion keeps Groq's demotion and replaces its reason. **8,000 TPM is ~2.6 calls a
minute** and a delegating turn is two of them, so the ceiling binds on an ordinary conversation
rather than on load. Measured as a conversation instead of as a benchmark, the third message in a
burst cost 12.8 s — and **the runtime never advanced to the configured fallbacks**, retrying in
place and logging no fallback decision at all. A rung whose failure mode is a silent thirteen-second
stall does not belong on the lane that owns the conversation. It belongs at the bottom of it, where
the alternative is no answer.

**What is *not* claimed here is that this re-explains the 40.4 s.** ADR-0009 already assigned that
number to the ~41 s token-bucket reset, and nothing measured for this record contradicts it or
reproduces it. There is an unreconciled detail rather than a correction: under the ceiling as
measured now, #56's front-lane call of 6,141 prompt tokens carrying `maxTokens: 8192` should have
been refused outright, and #56 records it as fitting. Either the accounting differed on the day or
the front and worker calls were not shaped alike. It is left open, because the composition does not
turn on it and a tidy story here would be invented rather than measured.

## No two lanes share a quota bucket, and that is now a choice rather than a hope

ADR-0009 accepted a risk it could not avoid: Flash Lite's 500/day was *"load-bearing on two lanes
rather than one"*. Gemini's own refusal names the quota —
`GenerateRequestsPerMinutePerProjectPerModel-FreeTier` — so the ceiling is **per project per
model**, and two distinct Flash Lite models are two distinct allowances. Giving 3.5 to the front and
3.1 to the worker retires that risk for free, and it is the reason 3.1 Flash Lite is deliberately
absent from the front chain despite being fast enough for it.

Mistral is the other pair split across lanes, and it is per model too, visibly: `ministral-3b` and
`ministral-8b` report different per-minute rungs on the same key, so they are two rows rather than
one allowance seen twice. Mistral publishes its remaining tokens on every response, which is what
makes this checkable rather than inferred.

The same per-model shape holds on Groq, and buys nothing: **every tool-capable Groq model carries
the same 8,000 TPM**, and the two models with 70,000 refuse tool calling outright, so no Syrax lane
can reach their headroom. OpenRouter is the opposite again and says so — `free-models-per-day` is
the **account's** quota across all free models, so a chain of `:free` rungs is one rung wearing
several names. That is why OpenRouter appears in neither lane.

## The invariant measured the wrong quantity

ADR-0009 stated it as a rule with no enforcement, which was right, and stated it about the wrong
number:

> A rung's per-request token ceiling must exceed the largest single call its lane makes: ~6.2K on
> the front, ~13.4K on the worker.

A request is not charged its call. On Groq a **streaming** request is charged its prompt **plus the
output it reserves**, so a 2,745-token prompt was presented as `Requested 10931` against an 8,000
ceiling — and ~~the identical call sent without streaming was not refused at all~~ *(spent —
[ADR-0034](0034-the-reservation-is-charged-whether-the-call-streams-or-not.md))*. OpenClaw streams.
The invariant becomes:

> **A rung's per-request ceiling must exceed the largest call its lane makes *plus that rung's own
> configured `maxTokens`*.** The reservation is per model, not per lane, so two rungs of one chain
> can sit on opposite sides of the same ceiling. Both halves are Syrax's to set, which makes a rung
> that does not fit a configuration to change before it is a rung to remove.

This is the correction that matters most, because the old form is what let a self-inflicted `413` be
read as a property of the provider — ADR-0009 concluded that **Groq leaves the worker lane
permanently**, and `docs/research/free-tier-limits.md` hardened that into *"at any hour of any
day"*. Groq serves sub-agent calls, measured on the pinned runtime. `CONTEXT.md`'s **Wall** entry
carried the same error in the glossary and was corrected in #94's own session.

## `maxTokens` is configuration Syrax states, per model

It was never decided. It came from a prototype's model definitions, sat at `8192`, and silently
spent more of Groq's 8,000-token minute than the entire prompt did. This is
[ADR-0008](0008-the-front-lane-does-not-stream.md)'s three-timeout-keys situation exactly: a default
that is wrong for Syrax, whose failure is invisible until something reads a refusal closely.

It is pinned per model rather than globally, because it is half of the invariant above and the
lanes' calls differ by a factor of two. A change to it is a change to which rungs fit.

## The front lane is told not to guess, and the instruction had to be measured twice

Disposition was the least-measured criterion, so it was measured: twenty questions no model could
answer without a tool it did not have, graded for whether the reply asks or invents. The first
result **inverted the composition this record was about to state** — the rung proposed for the tail
invented nothing, and the proposed rung 1 invented half the time, with the worst of them answering *"the
backup finished at 3:00 AM"* to a question about a machine it had never seen.

The second result dissolved it. One instruction — *never state a fact you have not verified; if you
cannot, say so and ask* — took every candidate to at most one invention in twenty, and the replies
stayed useful rather than merely refusing. **Confabulation was a property of the prompt, not of the model.** So
the composition stands and acquires a line of standing prompt, and the general lesson is the one
worth keeping: *an eval that overturns a model choice should be re-run against a fair prompt before
the choice is changed.*

### The carrier is a workspace `AGENTS.md`, and this was checked rather than assumed

ADR-0008's own general finding is that **a platform capability is not a system capability until the
thing that would call it has been checked** — #50 built on `sendMessageDraft` for three tickets
before anyone looked for it in the runtime. That applies here: #94 measured the instruction through
direct API calls, which says nothing about whether the pinned runtime can deliver it.

It can. `agents.defaults.workspace` already points at a directory; an `AGENTS.md` there is injected
as project context, confirmed with a canary token the model was told to emit and did. It survives
`skipBootstrap: true` — which trims other project context from ~4,750 to ~1,140 characters but
leaves the workspace file alone — so ADR-0011's saving is intact and the two settings do not
conflict.

**One clause of the instruction is load-bearing and was found by accident: it must tell the model
not to mention the file.** Without it the reply read *"I cannot verify that because AGENTS.md
explicitly states I have no tools"*, which hands the Owner a filename instead of an answer and
fails [#11](https://github.com/Jerome-Group/syrax/issues/11)'s *every chat aims conversational*.
With it, the same question gets a plain refusal and a question back.

## ADR-0008 survives on one of its two arguments

It argued the front lane need not stream **on value** — at Cerebras' ~3,000 tok/s an expanded reply
was a fraction of a second, so there was no perceptible window to fill — and **on availability**, since
`sendMessageDraft` occurs zero times in the pinned runtime and ADR-0003 forswore building the call.

The value argument is **struck, not amended.** The same reply on the new rung 1 takes seconds
rather than a fraction of one, past the bound [#59](https://github.com/Jerome-Group/syrax/issues/59)
had already recorded, so ADR-0008's own first *revisit when* — *the front lane's fastest rung stops
being fast* — has fired. Amending it would leave a reader weighing a comparison that no longer
holds; striking it leaves the record honest about which leg it stands on.

**The decision is unchanged and now rests on availability alone.** There is no code path, so there
is nothing to trade off. What this costs is that the decision is no longer *also* a good idea: if
the runtime ever gains a token-level path to Telegram, the question reopens immediately and with no
argument in reserve, where before it had one.

## *Never dark, only slow* holds, and *slow* now means a minute

Z.AI answered 10 of 10 and publishes no token or daily ceiling, so the guarantee — which ADR-0009
narrowed to *never dark for want of allowance* — is intact exactly as written. What moved is the
speed: like for like against #56's 0.68 s median on short calls, `glm-4.5-flash` now answers a terse
turn in **13.99 s**, and an expanded one in 32.7 s with a 73.8 s p90.

Nothing about the guarantee changes; what changes is what it buys. A floor that answers in a minute
cannot be what serves an ordinary delegating turn, which is why Gemini 3.1 Flash Lite takes the top
of the worker lane and Z.AI keeps only the bottom. The floor is now genuinely a floor rather than a
working rung, and that is the honest reading of a promise that was made when it was fast.

## Consequences

- **The composition is correct on 2026-08-20 and will not stay correct.** ADR-0009 said this and it
  is truer now: Cerebras' whole tier vanished, `gemini-2.5-flash-lite` was withdrawn mid-effort, and
  three model names turned out to be aliases.
  [ADR-0012](0012-a-rotted-rung-is-reported-and-never-repaired.md) is the standing answer; this
  record is another instance of the problem it exists for.
- **The invariant is still a rule with no enforcement**, and now has two terms instead of one, so
  there is more to get wrong. Its failure still surfaces as a lane that refuses every large call.
- **`ministral-3b-latest` is a 3B model on the front lane's second rung.** It was chosen because its
  allowance cannot be exhausted by one person, and it invented on most of the eval's questions
  before the instruction and on one after. That is a real dependence on a prompt line holding, and it is the rung to suspect first if the Owner reports Syrax making things up.
- **The front lane's prompt grows.** ADR-0011 measured it at ~2,900 tokens; the workspace file is
  **258 injected characters**, or roughly 70 tokens at the 3.67 chars-per-token that ADR-0011
  measured. Daily capacity falls proportionally. Small, and a cost rather than free.
- **ADR-0011's `contextInjection: "continuation-skip"` is no longer worthless.** It was skipped
  because *"there is nothing left to inject"* once the workspace is empty. The workspace is no
  longer empty, so that knob now has something to skip and should be re-weighed rather than
  inherited as settled.
- **No pull request implements any of this.** Both chains, `maxTokens` and the workspace file live
  in the private runtime root, and this record is the only public statement of them.

## Revisit when

- **Any rung's allowance changes shape.** The whole composition is an ordering on failure rate, and
  every input to it was measured on one day.
- **The Owner reports a confident wrong answer.** The instruction is the only thing standing between
  three of these five models and confabulation, and the eval measured the ungrounded case rather
  than a tool that failed silently — which is the same case arriving by a route nobody watched.
- **A rung's ceiling stops being expressible as `call + maxTokens`.** The rule was isolated on Groq
  by elimination, and one variant carrying `reasoning_effort` did not follow it. What is recorded is
  a trap that reproduces, not a formula that was derived.
- **The pinned runtime gains a real per-agent prompt setting, or a token-level path to Telegram.**
  The first would retire the workspace-file carrier; the second reopens ADR-0008 with no argument
  left in reserve.
- **The runtime starts advancing the chain on a bucket 429 instead of retrying in place.** That
  behaviour is what makes Groq's stall silent, and it is the single assumption keeping Groq at the
  bottom rather than the middle of the front lane.
