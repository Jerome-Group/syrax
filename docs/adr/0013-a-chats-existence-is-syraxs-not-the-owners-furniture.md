# A chat's existence is Syrax's, not the Owner's furniture

The Owner deleting the Telegram topic that carries a chat is a **view** operation, not a
decommission. The set of chats is the system's shape, so the next write bringing the topic back is
neither self-healing nor misbehaviour — it is Telegram restoring the Owner's view of a structure
that never went away. **A chat ends when Syrax stops being configured for it**, and never because
its carrier was cleared.

This record amends nothing in `docs/adr/`. Nothing here owned the chat surface:
[ADR-0003](0003-the-runtime-adapter-wraps-openclaw.md) is the runtime adapter and
[ADR-0008](0008-the-front-lane-does-not-stream.md) the front lane. What it does amend is
[#11](https://github.com/Jerome-Group/syrax/issues/11)'s startup reconciliation instruction, which
has lived on an issue ever since — which is exactly why it drifted, and exactly why this is a
record rather than a fourth comment on the thread.

## The gesture is not addressed to Syrax

Both readings the question arrived with — *self-healing is a bug*, and *resurrection is correct* —
shared a premise, and it is the premise that is wrong: that deleting a topic says something **to**
Syrax. It does not. It says something to Telegram about what the Owner wants on their screen.

The argument has three legs, and the middle one is load-bearing because it kills the alternative
outright rather than merely making it expensive.

**Syrax is deaf to it.** No update is emitted when a topic is deleted client-side. The only
discovery path is the write that resurrects it — measured in
[#63](https://github.com/Jerome-Group/syrax/issues/63). Every design that responds to a deletion
must first detect one, and there is nothing to detect it with.

**Syrax could not obey it if it heard it.** [#9](https://github.com/Jerome-Group/syrax/issues/9) has
Seerr's own Telegram agent posting availability into the Media topic **on Syrax's bot token** — that
is why Syrax builds no completion pathway of its own. A Syrax that refused to post could not keep
the Media chat deleted; the second holder of the token would bring it back on the next release. So
the *obey the deletion* reading is not merely unimplementable for want of a signal. It is
**unenforceable**, and would stay unenforceable if the signal arrived tomorrow.

**Obeying it breaks a contract already decided.**
[#10](https://github.com/Jerome-Group/syrax/issues/10)'s 07:00 academic brief is never-silent
*because absence is its heartbeat*. A Syrax that went quiet rather than post into a deleted Academic
chat would be indistinguishable from a dead bot — it would honour a deletion it never heard by
disabling the one signal that says it is alive.

## The standing constraint, answered rather than dodged

*Agents do nothing more, nothing less than what they are configured for* is what made resurrection
look like a bug, and it deserves a direct answer instead of a silence.

It is not breached. **Syrax sent a message it was configured to send, and Telegram did the rest.**
The topic reappearing is a platform response to an authorised write, not an initiative. Reading it
as an initiative requires attributing to Syrax an intent it has no way to form — it cannot know the
topic was gone.

## The rejected alternative, in all three of its forms

*Self-healing is a bug* arrived with three proposed responses, and none survives:

| | Fails on |
|---|---|
| **Refuse to post** into a deleted chat | All three legs. Needs detection Syrax lacks, enforcement Seerr's token denies, and it silences the brief |
| **Report the resurrection** to the System chat | Leg 1 alone, and fatally: Syrax cannot tell a resurrection from an ordinary send |
| **Recreate, but say so** | Leg 1 alone, identically |

The last two are worth separating from the first because they look modest — they only *observe*.
But observation is the thing that is missing. Every send would have to be reported, or none could
be, and a report on every send is not a report.

## The asymmetry has a shape, and it stays a hypothesis

A bot-deleted topic stays deleted; a user-deleted one comes back **holding its messages**. That
reads like the client's delete being a clear-my-copy operation in a private chat rather than a
server-side delete.

**This record does not upgrade that to a finding.** #63 recorded the observation and explicitly not
the mechanism, and nothing since has tested it. It is written down because a reader who notices the
asymmetry deserves to know it was noticed too — not because anything above rests on it. Nothing
does: all three legs hold whatever the mechanism turns out to be.

## What is struck from #11, and what stands

**Struck: *"at startup, verify each id still resolves"*.**

**Verification is a write-path concern, not a startup rite.** Sending is the only discovery path
there is, so every send is already a discovery: a `400 message thread not found` recreates and
retries on the spot, wherever it happens. A startup pass buys nothing over that and costs a visible
probe message posted into every chat and deleted again on every launchd restart — which under
`KeepAlive` is not a one-off.

It handles #11's *realistic* failure identically. That rule was written for a **lost map on a fresh
runtime state directory**, and there every first write fails and every first write recreates. The
startup pass was never the thing that saved that case; the write path was.

**Standing, unchanged:** persist the `chat → topic id` map; **never match a chat to its topic by
name**; an unrecognised thread id is answered as General and noted in System.

## A recreation is announced; a resurrection is not

The distinction is the whole of the reporting rule, and it is not a fine one.

A **resurrection** returns the chat with its messages and its id intact. Syrax cannot see it and
nothing is lost, so there is nothing to say.

A **recreation** — after a bot-side delete, or a lost map — returns the chat **empty and with a new
id**. That is announced in the System chat, exceptions-only in
[#25](https://github.com/Jerome-Group/syrax/issues/25)'s shape, and the line names the
**consequence** rather than the event, because there is one worth naming.

**Syrax is not the only holder of a topic id.** Seerr holds the Media topic's in its own
configuration and posts there directly, so a recreated Media chat leaves Seerr posting into a dead
thread — and Seerr's `400` is invisible to Syrax. Re-pointing Seerr is therefore part of the
recreate path, and it lives in the provisioning wizard's text rather than in code: Syrax pushing the
new id to Seerr was rejected on #9's boundary, and both routes to a recreation are already *the
wizard runs again* territory.

## General is not a special case, and two attempts to make it one failed

The semantics above apply to General exactly as they apply to Academic, Media and System.

This record deliberately did not decide General's address — that was
[#81](https://github.com/Jerome-Group/syrax/issues/81)'s to measure and
[#80](https://github.com/Jerome-Group/syrax/issues/80)'s to settle, and both have since resolved:
**General is an ordinary created topic**, and the chat root is not a carrier but the place a message
with no thread id arrives, answered as General and never dropped.

The route there is worth recording, because it is the strongest argument this record has for stating
its rule as a *rule*. Two separate attempts were made to put General somewhere structurally
undeletable, and both died on measurement — adopting thread id 1
([#28](https://github.com/Jerome-Group/syrax/issues/28): it does not exist in a private threaded
chat), and binding General to the chat root (#80: the root has no view of its own, so a chat carried
by it could not be read apart from every other chat's messages).

So *a chat's existence is Syrax's* is **a rule Syrax keeps, not a property the platform can be made
to enforce.** Every chat's carrier is clearable by the Owner, and the answer to that is this record
rather than a mechanism.

## Consequences

- **Startup gets cheaper, and it matters more than it looks.** Under `KeepAlive`
  ([ADR-0005](0005-launchd-supervises-syrax-as-two-launchagents.md)) a crash loop is a restart loop,
  and a startup rite that posts and deletes a probe in every chat is a rite that runs on every one
  of them. Removing it removes a visible symptom of an invisible problem.
- **The first write after a deletion pays a round-trip and a retry.** That is the whole cost of
  moving verification onto the write path, and it is paid only where a topic is actually gone.
- **Nothing tells the Owner their delete did not take.** They cleared a chat, it came back, and
  Syrax said nothing — by design, because it did not know. The mitigation is documentation, not a
  signal: the `Chat` entry in `CONTEXT.md` says whose the existence is, and this record says why.
- **A recreation is a two-system event and only one system knows.** Seerr keeps posting into a dead
  thread until a human re-points it. The announcement exists to make that human act; it cannot make
  Seerr act.
- **Decommissioning a chat is out of scope for v1** — the Owner saying *stop using Media* at all.
  Nothing in v1 asks for it, and the configure-and-restart path exists for free. If it is ever
  wanted, the right form is a System-chat command with in-chat confirmation, and it is its own
  effort rather than a resumption of this one.

## Revisit when

- **Telegram emits a topic-deletion update to bots.** Leg 1 falls, and *report the resurrection*
  becomes buildable. It still fails legs 2 and 3, so the decision holds — but the reasoning would
  need to be re-read rather than assumed.
- **Seerr stops posting on Syrax's bot token.** Leg 2 rests entirely on a second holder of the
  token. If #9's arrangement changes, the strongest leg of this argument goes with it.
- **A chat acquires a carrier the Owner cannot clear.** Both candidates are spent, but the platform
  moves — private-chat topics themselves shipped in 2026. A genuinely undeletable carrier would make
  the rule structural for that chat, and the section above is written so the next attempt starts
  from what the last two measured.
- **Recreations turn out to be common.** The announcement is sized for an exception. If it fires
  routinely, the question is not the wording — it is why the map is being lost.
