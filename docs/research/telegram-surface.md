# Telegram as the chat surface — topics, streaming, lockdown

Research for [#6](https://github.com/Jerome-Group/syrax/issues/6). Facts verified 2026-08-15
against Bot API **10.2** (released 2026-07-14, per the
[Bot API changelog](https://core.telegram.org/bots/api-changelog)). Everything below is from
Telegram's own documentation unless marked otherwise.

## The question

The Owner wants one home with per-domain chats ("the media server has its own chat") — the
working assumption was a forum supergroup with topics. Establish the surface options, per-topic
routing, streaming mechanics under the rate limits, confirmation flows, single-user lockdown,
webhook vs long-polling from a home Mac mini with no inbound ports, and the length/formatting
limits that bear on concise output.

## Surface options

### Topics in the bot's private chat — new, and a direct fit

Since Bot API 9.3 (2025-12-31), a bot's **1:1 private chat can itself be a forum**: "Bots can
also behave like forums if **Threaded mode** is enabled via @BotFather"
([Forum topics](https://core.telegram.org/api/forum)). The
[changelog](https://core.telegram.org/bots/api-changelog) entries:

- **9.3** — `message_thread_id`/`is_topic_message` on `Message` in private chats with topic mode;
  `message_thread_id` accepted by `sendMessage` and every other send/copy/forward method, and by
  `sendChatAction`; plus `sendMessageDraft` (see Streaming below).
- **9.4** (2026-02-09) — bots can create private-chat topics via `createForumTopic`; a
  @BotFather setting controls whether the *user* may ~~create/delete~~ **create** topics
  (`allows_users_to_create_topics` on `getMe`); `has_topics_enabled` on `getMe` reports the mode.
  *(The "/delete" half is this document's paraphrase and it is wrong:
  [#63](https://github.com/Jerome-Group/syrax/issues/63) measured the Owner deleting a topic with
  the flag `false`. It gates creation only.)*

`createForumTopic`, `editForumTopic`, `deleteForumTopic` and `unpinAllForumTopicMessages` all
operate on "a forum supergroup chat **or a private chat with a user**"; the admin-rights clauses
apply only "in the case of a supergroup chat"
([Bot API](https://core.telegram.org/bots/api#createforumtopic)). So in the private chat there
are no admin rights, no group membership, no other members possible — per-domain topics inside a
chat only the Owner and the bot can see.

Maturity caveat: this shipped December 2025, and the 10.0 rollout (May 2026) briefly broke
sending to existing private-chat topic threads
([tdlib/telegram-bot-api#847](https://github.com/tdlib/telegram-bot-api/issues/847)). New
surface area still settling; keep the forum-supergroup fallback in mind. *(Discharged for the
three calls this system depends on — see [Verified in practice](#verified-in-practice).)*

### Forum supergroup with topics — the assumed option, fully workable

Any supergroup can become a forum; enabling it "can only be invoked by admins with owner rights"
([Forum topics](https://core.telegram.org/api/forum)) — in the apps it is a toggle in the group
settings. For the bot to manage topics it "must be an administrator in the chat ... and must
have the `can_manage_topics` administrator right"
([createForumTopic](https://core.telegram.org/bots/api#createforumtopic)); deleting a topic
needs `can_delete_messages`. Every forum has a non-deletable **General** topic with `id=1`
([Forum topics](https://core.telegram.org/api/forum)).

Costs relative to the private-chat option: group mechanics (invite links, membership) become an
attack surface to lock down, the bot needs privacy-mode handling (below), and the **group rate
limit — 20 messages/minute — throttles streaming edits hard** (below).

### Multiple bots — one per domain

Works, but each domain is a separate token, a separate chat in the chat list, separate BotFather
settings, and another runtime to wire. It buys per-domain isolation Syrax does not need (one
Owner, one runtime) and loses the "one home" the ticket asks for. No further mechanics worth
recording.

### Channels — not a chat

Channels are one-way broadcast surfaces; two-way conversation happens only in a linked
discussion group or in the channel's "direct messages" chat (a special supergroup, Bot API 9.2)
([changelog](https://core.telegram.org/bots/api-changelog)). Wrong shape for a conversational
surface. Likewise **Communities** (Bot API 10.2) merely link "several supergroups, channels, and
bots ... around a shared topic" — a grouping of chats, not a chat with topics.

## Routing per topic

Incoming: a message in a topic carries `message_thread_id` ("unique identifier of a message
thread or forum topic to which the message belongs; for supergroups and private chats with forum
topics only") and `is_topic_message`
([Message](https://core.telegram.org/bots/api#message)). Messages in the General topic of a
forum supergroup carry no thread id — treat "absent" as General. *(A private threaded chat has no
General topic, and with `allows_users_to_create_topics` **on** its thread-less root creates a new
topic on the user's next message. With it **off**, "absent" is a real destination again —
[#63](https://github.com/Jerome-Group/syrax/issues/63) measured a root message arriving with no
`message_thread_id` and no topic created, so the "treat absent as General" rule holds on this
surface too, by configuration rather than by platform. See
[Verified in practice](#verified-in-practice).)*

Outgoing: pass `message_thread_id` on `sendMessage` (and every other send method, plus
`sendChatAction`) to land the reply in the right topic. Topic ids are stable: the id is the
service message that created the topic ([Forum topics](https://core.telegram.org/api/forum)).
The adapter therefore keeps one small map: domain → topic id, created via `createForumTopic`
(topic names are 1-128 characters).

## Streaming a fast reply

### Native draft streaming — private chats only

> **Superseded by [#50](https://github.com/Jerome-Group/syrax/issues/50).** Everything in this
> section is accurate about the *platform* and unreachable in *this system*: the pinned runtime
> (`openclaw@2026.6.34`) contains no reference to `sendMessageDraft` anywhere in `dist` or `docs`,
> and [#14](https://github.com/Jerome-Group/syrax/issues/14) gave the channel to the runtime. The
> front lane sends a finished `sendMessage` and does not stream. Read on for the mechanics; do not
> reach for the method.

Bot API 9.3 added [`sendMessageDraft`](https://core.telegram.org/bots/api#sendmessagedraft):
"Use this method to stream a partial message to a user while the message is being generated.
Note that the streamed draft is ephemeral and acts as a temporary 30-second preview — once the
output is finalized, you **must** call `sendMessage` with the complete message to persist it."
Details: `chat_id` is "the target private chat"; takes `message_thread_id` (so it works
per-topic in a threaded private chat); `draft_id` non-zero, "changes to drafts with the same
identifier are animated"; text 0-4096, and "pass an empty text to show a 'Thinking…'
placeholder" (empty text allowed since 10.0). This is purpose-built token streaming — no edit
throttling at all — and it **does not exist for groups**.

### Edit-throttled streaming — the fallback, and the only option in a supergroup

The classic pattern: send a stub, then `editMessageText` as tokens arrive, final edit on
completion. The documented flood limits
([Bot FAQ](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this)):

| Scope | Limit |
|---|---|
| One chat | "avoid sending more than one message per second"; short bursts tolerated |
| One group | "not able to send more than 20 messages per minute" |
| Global broadcast | ~30 messages/second (paid broadcasts up to 1000/s exist but require 100k Stars and 100k MAU — irrelevant here) |

Exceeding a limit returns HTTP 429 with `retry_after` ("the number of seconds left to wait
before the request can be repeated",
[ResponseParameters](https://core.telegram.org/bots/api#responseparameters)) — always honour it.
Edit-specific ceilings are not officially documented; grammY's flood-limit page reports the
observed group ceiling as ~20 edits/minute per group
([grammY: flood limits](https://grammy.dev/advanced/flood)). Practical throttles: **private
chat ~1 edit/second; forum-supergroup topic one edit every 3-5 seconds** to stay under 20/min
with headroom for the final message. `sendChatAction` (`typing`, cleared after ≤5 s or on the
next message) covers the first-token gap either way.

The rate-limit asymmetry is itself an argument for the private chat: 1/s versus 20/min is the
difference between streaming that feels live and streaming that visibly lurches.

## Confirmation flows ("which file did you mean?")

**Inline keyboards** are the right tool: buttons attached to the bot's message, each with
`callback_data` of "1-64 bytes"
([InlineKeyboardButton](https://core.telegram.org/bots/api#inlinekeyboardbutton)) — enough for
an index into a runtime-held candidate list, not for a file path; keep the mapping in private
runtime state. On a press the bot receives a `callback_query`, and "Telegram clients will
display a progress bar until you call `answerCallbackQuery`. It is, therefore, necessary to
react ... even if no notification to the user is needed"
([CallbackQuery](https://core.telegram.org/bots/api#callbackquery)). After answering, edit the
message to reflect the choice and drop the keyboard. `answerCallbackQuery` can show a passive
toast (0-200 chars) or an alert (`show_alert`).

This paragraph says nothing about topics, because the documentation it is drawn from says nothing
about the combination. All of it is now measured on the surface actually chosen — including two
things the documentation does not state: the callback carries the thread id, and the query id
expires. See **Verified in practice**.

**ForceReply** exists for free-text follow-ups — it opens the reply interface so the next
message threads back to the bot's question, designed so a privacy-mode group bot still sees the
answer ([ForceReply](https://core.telegram.org/bots/api#forcereply)). In a single-user private
chat it adds nothing over just reading the next message in the topic; reserve it for prompts
that need free text rather than a pick-one.

## Locking the bot to a single user

There is no private-bot switch: any Telegram user can open a chat with any bot. Lockdown is
layered, all layers cheap:

1. **Owner allowlist in the adapter** — the load-bearing layer. Accept an update only when
   `message.from.id` (and for callbacks, `callback_query.from.id`) equals the Owner's numeric
   user id **and** the chat id is the expected home chat; drop everything else unanswered.
   Numeric ids, never `@username` (usernames are mutable and reassignable). The Owner's id and
   the home chat id are private runtime state, not tracked configuration.
2. **BotFather hardening** — `/setjoingroups` off, so the bot cannot be added to any group
   ([Bot features](https://core.telegram.org/bots/features)). With the private-chat-topics
   option this closes the group surface entirely. The forum-supergroup option instead needs
   joining enabled once, the bot added as admin, then joining disabled again.
3. **Privacy mode** (forum-supergroup option only): privacy mode is on by default and limits
   what a group bot sees, but "bot admins always receive all messages"
   ([Bot features](https://core.telegram.org/bots/features#privacy-mode)) — the bot must be
   admin anyway for `can_manage_topics`, so no `/setprivacy` change is needed.
4. **Transport authenticity** — with long polling there is no inbound surface at all; with a
   webhook, set `secret_token` so every delivery carries the
   `X-Telegram-Bot-Api-Secret-Token` header
   ([setWebhook](https://core.telegram.org/bots/api#setwebhook)), and optionally restrict to
   Telegram's published source subnets `149.154.160.0/20` and `91.108.4.0/22`
   ([webhook guide](https://core.telegram.org/bots/webhooks)).
5. **Token hygiene** — the bot token is the whole identity; it enters through the deployment
   environment per this repository's rules, never through tracked configuration.

## Webhook vs long polling from a home Mac mini

[`getUpdates`](https://core.telegram.org/bots/api#getupdates) long polling is outbound-only
HTTPS: the runtime holds an open request (`timeout` in seconds; "short polling should be used
for testing purposes only"), needs no public endpoint, no TLS certificate, no port forwarding,
and works behind NAT/CGNAT. It "will not work if an outgoing webhook is set up" — the two are
mutually exclusive, and only one poller may run at a time. `drop_pending_updates` (via
`deleteWebhook`) discards a backlog after downtime if staleness matters more than completeness.

**`allowed_updates` is persistent state on the bot, not a per-call argument.** The Bot API
documents it as "a JSON-serialized list of the update types you want your bot to receive… Please
note that this parameter doesn't affect updates created before the call to `getUpdates`, so unwanted
updates may be received for a short period of time" — which reads as a per-call filter with a lag.
It is not: whatever the last caller passed keeps filtering every subsequent poll until another call
changes it, and filtered updates are **dropped rather than buffered**, so they cannot be recovered
by re-polling with a wider list. [#63](https://github.com/Jerome-Group/syrax/issues/63) found this
bot still narrowed to `["callback_query"]` by [#53](https://github.com/Jerome-Group/syrax/issues/53)'s
harness — silently deaf to every message for two days. Nothing in @BotFather shows it; the only
read path is `getWebhookInfo.allowed_updates`, on a bot with no webhook.

A [webhook](https://core.telegram.org/bots/webhooks) requires a public HTTPS endpoint on port
"443, 80, 88, or 8443" with a verifiable certificate (self-signed possible by uploading the PEM)
— i.e. an inbound port or a tunnel (Cloudflare Tunnel, Tailscale Funnel), which adds a
third-party dependency to be always-on. Webhooks win on latency-per-CPU at scale; at
one-user scale the difference is noise.

For a Mac mini at home with "ideally no inbound ports": **long polling, clearly.** The webhook
path (with `secret_token`) is documented above should the runtime ever move to a host with a
public endpoint.

## Length and formatting limits

- Message text: "1-4096 characters after entities parsing" (`sendMessage`, `editMessageText`,
  `sendMessageDraft`); media captions 0-1024
  ([Bot API](https://core.telegram.org/bots/api#sendmessage)). Longer output must be split;
  splitting mid-code-block breaks rendering, so chunk on block boundaries. Concise output —
  already the house style — mostly avoids the problem.
- `parse_mode`: `MarkdownV2`, `HTML`, or legacy `Markdown`
  ([formatting options](https://core.telegram.org/bots/api#formatting-options)). Bold, italic,
  underline, strikethrough, spoiler, blockquote, inline links, `code`/`pre` with
  syntax-highlight hints. Judgement, not doctrine: prefer **HTML** — MarkdownV2 requires
  escaping many characters in ordinary prose and model output, and unescaped input is a
  runtime 400.
- `callback_data` 1-64 bytes; topic names 1-128 characters; `answerCallbackQuery` text 0-200.

## Verified in practice

Everything above was read from documentation. Everything here was **observed** on 2026-08-16 for
[#28](https://github.com/Jerome-Group/syrax/issues/28) — the first four against Telegram's own Bot
API server with a live bot in Threaded mode, the last in the Telegram client itself.

- **`createForumTopic` works in a bot's private chat.** Three topics created in one run, each with
  a distinct `icon_color`, each returning a stable `message_thread_id`. The recommendation's
  central premise holds and the forum-supergroup fallback is not needed.
- **`sendMessageDraft` animates inside a topic.** A run in General and a run in a created topic
  both streamed a sentence a word at a time at roughly two drafts per second, with **no draft
  rejected** and no `retry_after`. The streaming section above *inferred* per-topic drafts from the
  parameter list; it is now measured. This is the combination the surface choice rests on, and the
  one a supergroup would cost. *(Still true of the platform, and moot for this system — the
  measurement was a bare `curl`, and no code path from Syrax to Telegram can reach the method. See
  [#50](https://github.com/Jerome-Group/syrax/issues/50) below. The "roughly two drafts per second"
  is also not a platform ceiling: the wizard sleeps 0.5 s between drafts by design.)*
- **A private threaded chat has no General topic at all.** `editForumTopic` on
  `message_thread_id: 1` and `editGeneralForumTopic` both return `Bad Request: TOPIC_ID_INVALID`,
  and `sendMessage` to thread 1 returns `Bad Request: message thread not found`. Thread 1 does not
  exist: the non-deletable General topic with `id=1` that [Forum
  topics](https://core.telegram.org/api/forum) describes is a property of forum **supergroups**
  and does not carry over, which the routing section above assumed it did. Messages sent with no
  `message_thread_id` do display, but the client offers that root as *"type any message to create
  a new thread"* — it is a thread factory, not a chat anyone can hold a conversation in. So a
  catch-all chat is **created like any other topic**, and its name and icon colour are ours to
  choose rather than Telegram's to give. This corrects
  [#11](https://github.com/Jerome-Group/syrax/issues/11), which adopted General as `id=1` and
  concluded its icon was not ours to set.
- **`allows_users_to_create_topics` defaults to _on_.** A fresh bot with Threaded mode enabled
  reports `true` from `getMe`, so the user may create ~~and delete~~ topics until it is turned off
  in @BotFather. This corrects the premise [#11](https://github.com/Jerome-Group/syrax/issues/11)
  reasoned from when it judged a deleted topic unrealistic: its startup reconciliation rule —
  verify each stored id, recreate only what is gone, never match by name — is load-bearing rather
  than belt-and-braces. *(The deletion half is struck by
  [#63](https://github.com/Jerome-Group/syrax/issues/63): turning the flag off does not take
  deletion away, so the rule is load-bearing for a reason that outlives the toggle.)*
- **The client draws the topic list.** Four threads were posted to and the Owner confirmed they
  appear as a topic list rather than as one flat conversation. This is a different question from
  whether the API routes correctly, and it is the one that would have flipped the surface whatever
  the four results above said: a forum supergroup's topic UI has been mature since 2022, so a
  private chat that routed perfectly and *drew* as a single stream would have been the weaker
  option despite winning every API measure. It does not, so it is not.

Observed on 2026-08-17 for [#53](https://github.com/Jerome-Group/syrax/issues/53), against the same
live bot. The **Confirmation flows** section above was read from documentation that describes
inline keyboards without saying anything about topics either way, and #28 did not measure them.

- **Inline keyboards render inside a topic, and the callback identifies which one.** A three-button
  keyboard sent with `message_thread_id` set to a created topic was accepted, drew in the client,
  and the tap returned a `callback_query` whose `message` carries **`message_thread_id`** and
  **`is_topic_message: true`** alongside the usual `chat.id`. That thread id is what makes a tap
  attributable to a chat, and a chat is a capability boundary — a callback that could not be
  attributed would have made the button useless whatever else it did. `chat.type` remains `private`,
  so the topic is the only thing distinguishing one boundary from another on the way in.
- **An edit drops the keyboard unless the edit re-sends it.** `editMessageText` without
  `reply_markup` returns a message with no `reply_markup` at all; passing it again restores it.
  This is the documented semantic, measured here because [#13](https://github.com/Jerome-Group/syrax/issues/13)'s
  progress message is edited in place — so a keyboard on an edited message must be re-passed on
  **every** edit or it silently disappears mid-turn.
- **`answerCallbackQuery` expires, and it is not a long window.** An answer sent roughly two minutes
  after the tap was rejected with `Bad Request: query is too old and response timeout expired or
  query ID is invalid`. The documentation quoted above says a client shows a progress bar until the
  query is answered; it does not say the id stops being answerable. So the acknowledgement has to be
  the **first** thing a handler does, before any work the tap triggers — which matters here because
  the work behind a capture tap is a database write, and behind a candidate tap is a file read.

Read from the pinned runtime on 2026-08-17 for
[#50](https://github.com/Jerome-Group/syrax/issues/50), against `openclaw@2026.6.34` as installed —
its own `dist/` and `docs/`, not the published documentation site.

- **The runtime cannot send a draft.** `sendMessageDraft` occurs **zero** times across the entire
  package. Its Telegram channel calls `sendMessage` (216 occurrences), `sendChatAction` (25),
  `createForumTopic` (23), `sendPhoto` (11), `editMessageText` (9) and `answerCallbackQuery` (6).
  Since [#14](https://github.com/Jerome-Group/syrax/issues/14) gave the channel to the runtime and
  [ADR-0003](../adr/0003-the-runtime-adapter-wraps-openclaw.md) made the adapter a configuration
  contract rather than a wrapper, **the recommendation below named a method this system was never
  able to call.** Everything else the design needs is present: `editMessageText` for the progress
  message, `answerCallbackQuery` for the shortlist, `sendChatAction` for typing.
- **What the runtime streams is not tokens.** `agents.defaults.blockStreamingDefault` is `"off"` by
  default, and when on it emits 800–1200 character *blocks* with a 1 s coalesce window
  (`blockStreamingChunk`, `blockStreamingCoalesce`) — never word by word. Token-level streaming was
  not on offer from this runtime under any setting.
- **Typing indicators are built in.** `agents.defaults.typingMode` defaults to `"instant"` for
  direct chats, refreshing on `typingIntervalSeconds` (default 6), so the gap a draft would have
  filled is already covered without a message being sent or a rate limit being spent.

Observed on 2026-08-18 for [#63](https://github.com/Jerome-Group/syrax/issues/63), both sides of
`allows_users_to_create_topics` — the flag flipped in @BotFather between two runs of the same
probes, so each result below is a before/after pair rather than a single reading.

- **With the flag off, the root stops being a thread factory.** The client's composer placeholder
  changes from *"type any message to create a new thread"* to **"Off-topic message"**, and a
  message sent there arrives with **no `message_thread_id`, no `is_topic_message`, and no
  `forum_topic_created` service message** — nothing is created. With the flag on, the same gesture
  produced two updates on a fresh thread: `forum_topic_created` carrying
  `{"name": "before-toggle", "is_name_implicit": true}` — the topic is named after whatever was
  typed — followed by the message itself. So the flag decides whether the most natural gesture on
  this surface lands somewhere addressable or invents a capability boundary per message. The root
  is a full two-way channel with the flag off: the bot can `sendMessage` there, reply by
  `reply_to_message_id`, and raise a typing indicator, all with no thread id.
- **The bot is unaffected by the flag.** `createForumTopic` and `deleteForumTopic` both succeed
  with it `false`; it governs the *user*, which is what makes startup reconciliation still possible
  after it is turned off.
- **The Owner can still delete topics with the flag off.** Measured directly on a bot-created
  throwaway. This is the one result that contradicts what the ticket set out to confirm, and it
  keeps #11's startup reconciliation rule at full strength rather than downgrading it.
- **A user's deletion of a bot-created topic is not durable — the next bot write resurrects it,
  same id.** Three deletions were measured and only two stuck:

  | created by | deleted by | writes afterwards |
  | --- | --- | --- |
  | user, at the root | user, in the client | `400 message thread not found` — gone |
  | bot, `createForumTopic` | bot, `deleteForumTopic` | `400 message thread not found` — gone |
  | bot, `createForumTopic` | user, in the client | **`ok: true`, repeatedly** — the topic reappears in the client holding the messages |

  Every topic Syrax owns is bot-created and the Owner is the only human, so the third row is the
  only one that describes this system. Two variables differ across the rows and this was not
  controlled further; what is recorded is the observation, not the mechanism. The consequence for
  reconciliation is concrete either way: **verifying a stored id by sending to it is not a
  read-only check** — it is the very act that brings a deleted topic back, so "verify each stored
  id, recreate only what is gone" can never observe the gone case for a topic the Owner deleted.
  *(Decided on [#79](https://github.com/Jerome-Group/syrax/issues/79): the gesture is not an
  instruction, because it is not addressed to Syrax — a chat's existence is Syrax's, and the
  resurrection is Telegram restoring the Owner's view. #11's startup pass is struck and verification
  moves onto the write path, so there is nothing here Syrax wants to detect.)*
- **Topic deletion emits no update at all.** Neither the Owner's deletion nor the bot's produced
  anything on `getUpdates` — there is no `forum_topic_deleted` counterpart to `forum_topic_created`.
  A deleted topic is discoverable only by writing to it, which per the row above may recreate it.
- **`sendChatAction` does not validate `message_thread_id`.** It returns `ok: true` for thread
  `99999`, which has never existed, and for a thread confirmed dead by `sendMessage`. It is
  therefore useless as a liveness probe, and worth knowing because
  [#50](https://github.com/Jerome-Group/syrax/issues/50) found the runtime's `typingMode: "instant"`
  raises a typing indicator before the reply: the indicator will succeed against a deleted topic and
  the reply behind it will not. *(One candidate probe is left untested — `editForumTopic` with no
  fields changed, which does validate the thread id per the `TOPIC_ID_INVALID` result above.
  [#95](https://github.com/Jerome-Group/syrax/issues/95) measures it, so that "no read-only probe
  exists" becomes a fact about the platform rather than about how far this ticket looked.)*
- **A topic created while the update filter was narrowed is invisible forever.** One of the two
  before-toggle topics was created while `allowed_updates` was still `["callback_query"]`; it exists
  in the client and Syrax received nothing, and no re-poll replays it. Reconciliation verifies
  stored ids — it does not discover unknown ones.

## Recommendation

> **Amended by [#50](https://github.com/Jerome-Group/syrax/issues/50)**: point 3 below is
> withdrawn — the front lane does not stream, and `sendMessageDraft` is unreachable from the
> chosen runtime regardless. The surface recommendation itself **stands**, re-decided on its
> remaining planks rather than on drafts.

**One bot, locked to the Owner's user id, with Threaded mode enabled — per-domain topics inside
the bot's own private chat.** This is the ticket's "one home with per-domain chats" with less
machinery than the assumed forum supergroup: no group to secure, no admin rights, no invite
surface, lockdown by construction plus the from-id allowlist — and it unlocks the two best
mechanics on the platform for this use case: native token streaming via `sendMessageDraft`
(private chats only) and the 1 msg/s per-chat limit instead of the group's 20 msgs/min.

Concretely, for the decision ticket:

1. Bot via BotFather: Threaded mode **on**, `/setjoingroups` **off**; token into the
   deployment environment.
2. Adapter: allowlist `from.id` + chat id (numeric, private runtime state); route by
   `message_thread_id` with a domain → topic map built through `createForumTopic`; absent
   thread id = General.
3. ~~Streaming: `sendMessageDraft` per token batch (same `draft_id`), finalize with `sendMessage`;
   fall back to edit-throttled `editMessageText` (~1/s, honour `retry_after`) if drafts
   misbehave — the feature is under a year old.~~ **Withdrawn by
   [#50](https://github.com/Jerome-Group/syrax/issues/50).** The front lane does not stream: it
   sends a finished `sendMessage`, with `typingMode: "instant"` covering the gap. A *slow turn* —
   one where the front lane delegates — gets the progress message and its `editMessageText`
   instead.
4. Confirmations: inline keyboards with index-valued `callback_data`, always
   `answerCallbackQuery`, edit the message after the choice.
5. Transport: `getUpdates` long polling from the mini (timeout ~30-50 s); no inbound ports.
6. Output: chunk at 4096 on block boundaries; HTML parse mode.

**Fallback, pre-researched:** if private-chat topics prove immature in practice, a private forum
supergroup with the bot as admin (`can_manage_topics`) reproduces everything above except draft
streaming — there, throttle edits to one per 3-5 s under the 20/min group ceiling. Nothing else
in the adapter design changes; the routing key (`message_thread_id`) is identical, which keeps
the switch cheap in both directions.

> **[#50](https://github.com/Jerome-Group/syrax/issues/50) re-weighed this fallback and kept the
> private chat.** With drafts unreachable, "reproduces everything above except draft streaming"
> means the supergroup now reproduces *everything*, and the choice rests on the remaining planks:
> the private chat is already provisioned, needs no group membership secured, and keeps the 1 msg/s
> limit against the group's 20/min. The one thing the supergroup would still buy is a non-deletable
> General at `id=1` — where the private chat's root is a *thread factory*, so a message typed
> without picking a topic creates a new one instead of landing in General. That is closed instead
> by turning `allows_users_to_create_topics` **off** in @BotFather, ~~which also removes the topic
> deletion that made #11's startup reconciliation load-bearing~~. The toggle's effect on the root
> composer is unmeasured — [#63](https://github.com/Jerome-Group/syrax/issues/63).
>
> **[#63](https://github.com/Jerome-Group/syrax/issues/63) measured it, and the judgement holds on
> a better result than it assumed.** The root does not merely stop creating topics: a message typed
> there arrives with **no thread id**, which is the same "absent means General" rule this document's
> routing section already describes for supergroups. So the private chat now reproduces the one
> thing the supergroup was still buying, in the form the adapter was already written for. The
> struck clause is the half that did not survive — deletion is untouched by the flag, so #11's
> startup reconciliation stays load-bearing.
