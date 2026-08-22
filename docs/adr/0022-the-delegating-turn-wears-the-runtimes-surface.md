# The delegating turn wears the runtime's surface

The front/worker split is **four settings and two clocks**, and everything the Owner actually sees
while a slow turn runs is the runtime's, unchanged. Syrax states the worker chain on the sub-agent
override, names the three delegation tools back into the minimal tool profile, and states every
timeout that would otherwise be zero or inherited. It does **not** build a reply path of its own to
shape the progress message, because [ADR-0003](0003-the-runtime-adapter-wraps-openclaw.md) is what
says it may not: the adapter is a contract expressed in configuration rather than a layer of code
standing in front of the runtime.

Two consequences of that fall out immediately, and both are worth stating plainly because
[#123](https://github.com/Jerome-Group/syrax/issues/123) asked for a surface the pinned runtime
does not offer. They are measured, not read: `test/delegating-turn.test.ts` and
`test/lane-death.test.ts` drive the pinned gateway at both wires and record what crosses them.

## The progress message is one message, edited — and then removed rather than reduced

What was asked for is a draft that ends as a finished line with the answer beneath it. What
`streaming.mode: "progress"` gives is three quarters of that and a different ending:

| Asked for | Measured on `openclaw@2026.6.34` |
|---|---|
| One message posted at once | One `sendMessage`, once the turn has proved it is working |
| Edited as work proceeds | `editMessageText` on that same message, twice per tool event |
| The answer beneath it, never replacing it | A fresh `sendMessage` — the draft is never edited into the answer |
| Reduced to a finished line | **`deleteMessage`** — the draft is removed after the answer lands |

The deletion is not a setting, and it is not a hook either. On a delegating turn the draft's whole
life — one `sendMessage`, two `editMessageText`, one `deleteMessage` — crosses **no plugin hook at
all**; only the final answer passes through `message_sending`. `ChannelStreamingProgressSchema` is
strict and carries `label`,
`labels`, `maxLines`, `maxLineChars`, `render`, `toolProgress`, `commandText` and `commentary` —
there is no knob for what happens to the draft at completion, and a tool-progress-only draft is
cleared by construction. The only way to keep a finished line would be for Syrax to post its own,
which means a second message racing the runtime's own delivery on the path ADR-0003 keeps clear.

**So the thread does not keep a record of the work; it keeps the answer.** `CONTEXT.md`'s *Progress
message* entry claimed the reduction as part of the term and has been corrected in place, the way
its *Wall* entry was in #94.

## A death that advances the chain announces itself, and one that does not is silent

The other half of the same shape. Measured twice:

- A rung that **dies mid-answer** — the connection drops part-way — is retried beneath the chain,
  and nothing crosses the Telegram wire until the attempt that finishes. The half-answer is
  discarded: it reaches neither the Owner nor the retry's own context. This is the silent restart
  #123 asked for, and it is the transport's doing rather than a setting's.
- A rung that **stays silent** is abandoned on the idle clock and the chain advances at once — and
  the runtime posts `↪️ Model Fallback: <rung> (selected <rung>; timeout)` into the chat before the
  answer. That notice is built unconditionally in the reply runner; no configuration suppresses it.
  So the two deaths differ in what the Owner sees, and which one a rung dies is not Syrax's choice.

**The notice is reachable by a plugin, and the notice stays anyway.** A `reply_payload_sending` hook
sees it as a payload carrying `isFallbackNotice: true`, and returning `{ cancel: true }` stops it
while the chain still advances and the answer still lands — measured on the branch
`prototype/hush-fallback-notice`, which is why this is *"Syrax may not, on the boundary it chose"*
rather than *"the runtime cannot"*. The choice was made rather than deferred, and against
suppressing it, for three reasons in the order that decided it:

1. **The notice is currently the only thing that says a lane is degraded.** ADR-0012's answer to a
   rotted rung is a report, and the System chat is where a report belongs — but that report is not
   built. Cancelling the notice today does not move the signal to System; it deletes it, and the
   Owner learns their front lane has been answering from its second rung by noticing the replies got
   worse.
2. **A cancel hook sits on every reply, not on one.** The handler decides `cancel` for each payload
   the gateway is about to deliver, so a wrong predicate does not produce a visible bug — it produces
   a chat that goes quiet. That is a worse failure than the noise it removes.
3. **The first plugin is the one that costs.** ADR-0003's boundary is why this system has no request
   path to debug; the second plugin is an easy argument once the first exists, and each is another
   thing pinned against a hook API that moves with the runtime.

So #123's *a fast-path death restarts silently* is **declined rather than blocked**, and the trade is
noise on a degraded lane against knowing the lane is degraded at all.

The two together retire the part of #123 that asked for a partial to be continued below: **the
runtime never persists a partial in the first place.** ADR-0008 leaves the front lane unstreamed
and a worker's text surfaces only on completion, so on a death there is nothing to continue below
and nothing to hand the next model as context. What was designed as a repair is a description of a
failure mode this arrangement does not have.

## The clocks are Syrax's, and one of them was a hang

`agents.defaults.subagents.runTimeoutSeconds` defaults to `0`, which is **no timeout at all**: a
worker that never returns is a delegating turn that never ends. That is the whole reason this
record's timeouts are stated rather than inherited, and it is the same class of finding as
ADR-0008's three timeout keys.

Death is declared on two clocks at once, and they measure different things:

- **The idle watchdog is per provider** — `models.providers.<id>.timeoutSeconds` — and it measures
  *silence*, not duration. Three of the four providers answer a terse turn in about a second and get
  60 s; Z.AI is slow by design (13.99 s terse, 73.8 s at p90) and gets 180 s, because one number for
  both would declare it dead on an ordinary answer.
- **The whole-turn ceiling is one number** — `agents.defaults.timeoutSeconds`, 600 s — and a
  provider timeout cannot extend it. It is what stops a chain from spending four idle watchdogs in a
  row.

**How many attempts a rung gets is not Syrax's to set, and the answer is one.** The runtime allows a
same-rung retry after an idle timeout only when no fallback is configured
(`allowSameModelIdleTimeoutRetry: … && !fallbackConfigured`), so a rung that is part of a chain is
dead at its first idle timeout and the chain advances — measured, and asserted in
`test/lane-death.test.ts`. That is the behaviour ADR-0016 wanted when it recorded that Groq's
failure mode was a silent thirteen-second stall, and it arrives from configuring a chain at all
rather than from a setting.

A different failure shape gets a different count: a rung that drops its connection mid-answer is
retried once by the transport beneath the chain, and only the finished attempt is delivered. Nothing
in the configuration chooses either number.

`auth.cooldowns` is deliberately **not** written. Its rotation caps are *auth-profile* rotations
within one provider, and Syrax carries one profile per provider, so stating them would restate the
runtime's own defaults and change nothing — dead weight wearing the look of a decision.

## The ids were re-verified, and one of them is not in its own catalogue

Every rung of both chains was put to its live provider on 2026-08-22 before being pinned. Six of the
seven are listed in their provider's `/models`: `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`,
`ministral-3b-latest`, `ministral-8b-latest`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b`.

`glm-4.5-flash` is **not listed by Z.AI at all** — its catalogue returns nine GLM rows and no flash
variant — and it answers a completion normally. So the catalogue enumeration that verifies every
other rung would have removed this one wrongly, and the check that settles it is
[ADR-0012](0012-a-rotted-rung-is-reported-and-never-repaired.md)'s minimal completion. That is worth
keeping: **a provider's catalogue is evidence a model exists and is not evidence one does not.**

## Consequences

- **The Owner sees which rung answered when the front lane falls through.** Not what #123 wanted,
  and arguably not bad: the notice is the only thing that makes a degraded lane visible without
  reading a log. Turning it off is a plugin, and a plugin is an ADR-0003 amendment rather than a
  setting — so what stands between the Owner and a silent fallback is a decision, not a limit.
- **The worker lane's reservations are what make Groq a rung.** `openai/gpt-oss-20b` reserves 2,048
  against an 8,000-token ceiling and a 5,239-token call. Raise that reservation past 2,761 and the
  rung stops working — with a `413` that reads exactly like the provider's fault, which is the trap
  ADR-0016 spent half a record undoing.
- **A deployment that has not provisioned Z.AI has a three-rung worker lane and no signal saying
  so.** The floor refers to `/providers/zai/apiKey`, and a key that exists on the machine somewhere
  other than the store is a key the gateway cannot reach: the mini's own had been sitting in the
  provisioning-era `providers.env` since the providers were first keyed in, and nothing read it.
- **`delegationMode: "prefer"` is a prompt, not a rule.** It adds guidance telling the front lane to
  delegate anything more involved than a direct reply; it enforces nothing. A front lane that
  answers a research question itself is behaving within its configuration.

## Revisit when

- **The pinned runtime moves.** Both of this record's *cannot* claims are properties of
  `2026.6.34`: the strict progress schema and the unconditional fallback notice.
  `test/delegating-turn.test.ts` is the cheapest check against a new pin — it fails loudly if the
  draft stops being deleted, and `test/runtime-config.test.ts` fails if a stated key stops being
  one the runtime knows.
- **The System chat learns to report a fallback.** That is the condition this record's decision was
  made against: once a degraded lane is visible where it belongs, cancelling the notice in the
  conversation stops being a loss and becomes a straight improvement — and
  `prototype/hush-fallback-notice` is the working proof, not a guess. Reopening it means amending
  ADR-0003, which is the decision that was declined here rather than the one that was never asked.
- **A partial ever becomes visible.** If the runtime gains a token-level path to Telegram, ADR-0008
  reopens and so does this: a visible partial is the thing that would make continuing below one a
  real question rather than a described one.
- **A second chat starts delegating at the same time.** `maxConcurrent: 1` says one worker at a
  time; four chats that all delegate would queue behind each other, and the queue is invisible from
  the chat.
- **Z.AI's flash tier changes shape.** The floor is the one rung whose id no catalogue confirms, and
  the guarantee it carries — *never dark for want of allowance* — is the whole reason it is there.
