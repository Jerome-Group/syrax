# The front lane does not stream

The front lane sends a finished `sendMessage`. A typing indicator covers the gap. Only a **slow
turn** — one where the front lane delegates to the worker — gets a progress message, and the
progress message is triggered by that delegation rather than by a timer.

In configuration: `agents.defaults.blockStreamingDefault: "off"` and
`agents.defaults.typingMode: "instant"`, both **pinned explicitly** rather than inherited. Both
happen to be upstream's defaults today; a decision should be legible in configuration rather than
resting on a default that agrees with it by coincidence.

A future reader will wonder why a 2026 chat assistant does not stream. The answer is that it would
have been invisible.

## Streaming's value is proportional to generation duration, and to nothing else

Streaming and not-streaming differ only in what the Owner sees *between* the first token and the
last. Cerebras at ~3,000 tok/s makes that window **20–50 ms** on a terse reply and **~270 ms** on an
800-token expanded one. There is no perceptual difference on offer.

The latency a front-lane turn actually has is **tool calls** —
[#13](https://github.com/Jerome-Group/syrax/issues/13) established that a tool-using turn re-sends
its whole context on every call — and streaming cannot touch that, because during a tool call there
are no tokens to stream. Streaming targets the one phase of the turn that is already instant.

Checked across the whole chain rather than its best rung: Groq is comparably fast, and only Gemini
3.5 Flash Lite on a long expanded answer would make streaming perceptible — a rare rung times a rare
length. That is not worth a rung-conditional mechanism which fires monthly and is never exercised.
ADR-0009 has since demoted Groq on the front for unrelated reasons; the argument survives it,
because the rung it depends on is the fast one at the top.

## The mechanism was never reachable, which is the finding that outlives the decision

Read from the pinned `openclaw@2026.6.34` as installed — its own `dist/` and `docs/` rather than the
published site — **`sendMessageDraft` occurs zero times in the entire package.** The runtime's
Telegram channel calls `sendMessage`, `sendChatAction`, `createForumTopic`, `sendPhoto`,
`editMessageText` and `answerCallbackQuery`, and nothing else.

[ADR-0003](0003-the-runtime-adapter-wraps-openclaw.md) is why that is decisive rather than merely
inconvenient. It gave the channel to the runtime and made the adapter a **configuration contract
rather than a wrapper**, so building the call is precisely what this system has forsworn. The
capability was Telegram's throughout and was never Syrax's.

[#6](https://github.com/Jerome-Group/syrax/issues/6) named drafts as one of the two mechanics
justifying the surface choice, [#28](https://github.com/Jerome-Group/syrax/issues/28) measured them
with a bare `curl`, and [#25](https://github.com/Jerome-Group/syrax/issues/25) built mid-turn repair
machinery on their ephemerality. **Three tickets reasoned about a mechanism no code path could
reach**, and every measurement was true of the platform and irrelevant to the system.

So the general lesson is recorded plainly, because it is worth more than the decision it came from:
**a platform capability is not a system capability until the thing that would call it has been
checked.** #28 measured Telegram. Nobody measured OpenClaw.

Two smaller corrections fall out. What the runtime streams is **not tokens** —
`blockStreamingDefault` emits 800–1200 character *blocks* with a one-second coalesce, never word by
word, so the thing the Owner said they did not want was not on offer either. And #28's "roughly two
drafts per second" was **not a platform ceiling** but the wizard's own 0.5 s sleep between calls.
[`telegram-surface.md`](../research/telegram-surface.md) is annotated in place rather than left
readable as current advice.

## The three deadlines, which are recorded nowhere else

[#25](https://github.com/Jerome-Group/syrax/issues/25) asked for death on *time since the last
token, per lane, plus a whole-turn ceiling*. That survives, and it survives as runtime configuration
because of a distinction the question had collapsed: **rendering to Telegram and streaming from the
provider are different things.** This decision turns off the first; the second continues regardless,
so the watchdog still has chunks to time.

**Every relevant default is wrong for Syrax**, which is the finding rather than the mechanism:

| Key | Default | Why the default fails |
|---|---|---|
| `models.providers.<id>.timeoutSeconds` | idle watchdog falls back to 120 s | an eternity on a lane running at ~3,000 tok/s |
| `agents.defaults.timeoutSeconds` | 172800 s (48 hours) | not a ceiling in any useful sense |
| `agents.defaults.subagents.runTimeoutSeconds` | `0` — no timeout | **the worker lane can hang forever** |

One refinement is kept because it is better than what was asked for: the idle watchdog is **per
provider**, which is finer than per lane and expresses the intent exactly — each rung of a chain
gets its own window. The numbers themselves are the spec's, on #13's precedent for the context
ceiling. #25's *two recovery attempts* needs nothing here: it is already the runtime's chain
behaviour, measured in [#45](https://github.com/Jerome-Group/syrax/issues/45).

## What this changes in #25's repair machinery

Two of its four rules never touched drafts and **survive verbatim**, both having already been
relocated to the slow lane: a persisted partial gets a continuation below it rather than an edit to
completion, and the partial is passed to the second model as context rather than as a prefix to
complete.

The third **simplifies**. A vanished draft is restarted — but nothing is drawn now, so a failed
front turn is invisible rather than visible-then-vanishing, and the recovery is silent. The line
about "one message saying the first attempt was dropped" has nothing left to explain.

## The fast path shows a typing indicator, and the progress message is not on a timer

`typingMode: "instant"` refreshes on a six-second interval, so the indicator stays live across a
multi-call turn. It costs no Syrax code, no message and no rate-limit allowance.

The progress message is triggered by **delegation, not elapsed time**. A stopwatch would need
something sitting on the request path, and
[ADR-0006](0006-the-runtime-routes-and-syrax-owns-the-escape-hatch.md) deliberately put nothing
there; delegation is a decision the front agent already makes, at the moment it makes it.

The cost is stated rather than engineered around: **a front turn that is slow without delegating —
a degraded rung plus several retrieval calls — shows only the refreshing typing indicator.**
Accepted. This is what earns *slow turn* its glossary entry meaning **delegating** rather than
**lengthy**.

## The surface is re-decided, not merely retained

Dropping drafts did not force the surface question; it removed one of four planks. The 1 msg/s
limit, the absent group machinery and the lockdown-by-construction all survive, and the
provisioning is already paid for.

The one thing a supergroup would still have bought is a **non-deletable General**, and in the
private chat the root was a **thread factory**: a message typed without picking a topic created a
new one rather than landing in General, failing
[#11](https://github.com/Jerome-Group/syrax/issues/11)'s *the one chat that cannot be wrong* on the
most natural gesture there is. Against that, a reversal costs a second wizard, a hand-made
supergroup, admin promotion and every topic id rewritten.

It was kept on the judgement that `allows_users_to_create_topics` **off** closes the hole for free —
the one thing in the decision resting on an unmeasured fact, and deliberately filed as
[#63](https://github.com/Jerome-Group/syrax/issues/63) rather than left as an assumption. #63 has
since measured it: with the flag off, a root message arrives with **no `message_thread_id` at all**
and nothing is created, which is the *absent thread id means General* rule the adapter was already
written for. The judgement held, and it held in a better form than it was made in.

**One clause of it did not.** #50 also claimed the toggle removes the topic deletion #28 found
enabled by default. It does not — the flag gates creation only, and the Owner deleted a topic with
it `false` — so #11's startup reconciliation rule stays load-bearing for a reason that outlives the
toggle.

## Consequences

- A front-lane reply appears all at once. On a degraded rung answering slowly, the Owner sees a
  typing indicator and no other signal until the message lands.
- The three timeout keys are **configuration Syrax must set**, and each failure they prevent is
  silent if it is missed — most sharply `subagents.runTimeoutSeconds: 0`, where a hung worker lane
  has nothing to end it.
- The Owner's stated preference for the supergroup's look was **overruled on cost**, and it can
  overrule back. That is recorded rather than buried, since the build spends the decision.
- Which mechanism carries the progress message is **deliberately not established** here — the
  runtime offers more than one path and #13 assumed a capability without naming one. It is flagged
  for the spec rather than guessed at.

## Revisit when

- The front lane's fastest rung stops being fast. The whole argument rests on ~3,000 tok/s; at
  Mistral's measured 48–109 tok/s the same expanded reply takes ~3 s, which is a window a person can
  see, and [#59](https://github.com/Jerome-Group/syrax/issues/59) records that as the reason Mistral
  is not a front-lane rung at any token allowance.
- The pinned runtime gains a token-level rendering path to Telegram. The decision was made on value
  and *then* found to be forced; if the forcing lifts, only the value argument remains, and it should
  be re-read against the chain of the day rather than assumed.
- A front turn that is slow without delegating becomes common enough that the typing indicator is
  not enough. The trigger for the progress message is delegation by choice, and this is the symptom
  that would reopen it.
