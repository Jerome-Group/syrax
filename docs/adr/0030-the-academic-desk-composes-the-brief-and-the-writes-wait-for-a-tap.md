# The academic desk composes the brief, and the two writes wait for a tap

The academic pair is the first capability whose product does not lend a tool layer. Media's does —
`media-server` owns Seerr's, and Syrax builds nothing there — but `academic-os` and `ntulearn` both
expose a CLI with a versioned `--json` report and nothing else, which is exactly what
[#10](https://github.com/Jerome-Group/syrax/issues/10)'s **refresh-then-read** describes: Syrax
triggers each product's own refresh and reads its output, holding no credentials of theirs.

Three questions follow from that, and this record answers them: **where the asking lives**, **who
composes the 07:00 brief**, and **what a confirmation actually is**.

## The asking lives in a fourth resident unit

The desk is a unit in the shape of the other two — a wrapper, a pre-flight, `KeepAlive`, loopback
only — rather than a server the runtime spawns per gateway. Two things force it, and neither is
about the tools:

- **The brief is a poke at a loopback endpoint** ([ADR-0005](0005-launchd-supervises-syrax-as-two-launchagents.md)),
  so something has to be listening at seven in the morning whether or not a turn is in flight.
- **The desk writes into the chat without a turn asking it to.** A sync takes minutes and outlives
  the tool call that started it, so what it did is posted afterwards; a process the runtime owns is
  not a process that can promise to still be there.

It is not the lane monitor for the reason the lane monitor is not the gateway: that unit is *the one
place lane state lives*, and a capability's tools inside it would make its name a lie for a
port number's saving.

## The brief is composed here, not asked of a model

ADR-0005 said the brief would call the gateway. That was written when the gateway was the only thing
Syrax had that could post, and the retrieval report has since shown the other shape: a unit that
holds the bot token, reads what somebody else wrote, and posts it
([ADR-0007](0007-the-retrieval-loop-reports-and-never-retunes.md)). **The brief takes that shape.**

The argument is the brief's own contract. It is posted on an empty day *because its absence is the
signal* — a morning with no brief means Syrax is down
([ADR-0013](0013-a-chats-existence-is-syraxs-not-the-owners-furniture.md)) — and a brief that is a
model's turn is a heartbeat that stops when a free tier does. It would also be a heartbeat that can
fabricate: the day ahead is a list of times and titles, which is precisely what
[ADR-0016](0016-the-lanes-are-recomposed-on-failure-rate-and-the-front-lane-is-told-not-to-guess.md)
tells the front lane never to state without a tool. Composed from the mirror and the digest, it can
be wrong only where a product was wrong.

**What that costs is the thing #10 wanted from it**: a brief Syrax authored through the runtime
would land in the Academic topic's own session state, and one posted at the Bot API does not. The
follow-up question is answered from the tools instead — which is where every other academic answer
comes from anyway, and which cannot go stale between the brief and the question.

## A confirmation is a minted tap

The two sanctioned writes are `ntulearn sync` and calendar **Promotion**, and each stands behind an
in-chat confirmation. The mechanism is [ADR-0012](0012-a-rotted-rung-is-reported-and-never-repaired.md)'s
removal tap and [ADR-0026](0026-the-shortlist-is-the-units-and-the-file-is-handed-over.md)'s
shortlist, reused: the desk mints a value, the Owner taps the button carrying it, and the write
happens on that value and on no other input.

The alternative — telling the agent to obtain confirmation before calling the tool — is a
confirmation a model can decide it already has. It cannot decide it holds sixty-four bytes only this
process ever wrote down. A value is spent when it resolves and forgotten when the process dies, so a
second tap and an old tap both answer *expired*, and neither reaches a write.

**Neither read is gated, and that is the same principle from the other end.** Confirmation attaches
to consequence rather than to the word *refresh*: a calendar Refresh is pull-only and never touches
Live, and a Proposal is private and trivially discarded. Gating either would teach the Owner to tap
through confirmations, which is how the tap that matters stops being read.

## The calendar is expanded far enough to be a timetable, and says where it stopped

A mirror keeps recurring masters and dated exceptions compact rather than one row per week, so a
day's events have to be worked out from its rules. The desk walks `FREQ=DAILY` and `FREQ=WEEKLY`
with `INTERVAL`, `BYDAY`, `COUNT` and `UNTIL` — which is what a semester's timetable is written in —
and refuses the rest rather than approximating it. **A rule it did not walk is returned as
`unexpanded`, with the rule itself**, so a morning it cannot see fully never reads as a morning with
nothing in it.

## Consequences

- **ADR-0005's *the brief calls the gateway* is spent**, and is marked so in place per
  [ADR-0018](0018-a-spent-claim-in-an-adr-body-is-marked-in-place.md). Everything else that record
  says about schedules stands: launchd owns every wall-clock job and `ls ~/Library/LaunchAgents` is
  still the whole answer to *what can message me unprompted*.
- **A deployment that names no academic products cannot be generated.** The Academic chat carries
  seven tools, and a machine with nothing behind them is a chat that answers nothing and says why
  nowhere — [ADR-0019](0019-the-configuration-contract-is-generated-and-the-generator-runs-before-the-gateway.md)'s
  refusal, met at the deploy rather than at the question.
- **The modules root is the Academic chat's search scope and nothing else.** `searchScopes.academic`
  is what the brief reads announcements under and what scoped search is bounded to, so the two
  cannot drift into two roots ([ADR-0004](0004-syrax-owns-the-file-search-index.md)).
- **The unit count is four**, and ADR-0005's footprint budget covers every
  `com.jerome-group.syrax.*` unit summed, so this is the budget's business rather than a new one.
- **A product that is not installed is a warning, not a refusal.** The desk starts, the brief goes
  out, and the brief says what did not run — because refusing to start would turn a five-minute fix
  into the silent morning the brief exists to rule out.

## Revisit when

- **`academic-os` grows a delivery channel or a read command for the calendar.** Both would move
  work out of Syrax, which is the governing principle's direction: the capability's own product owns
  its tool layer. Reading the mirror file is what Syrax does because there is nothing to call.
- **A calendar the Owner keeps uses a monthly or yearly rule.** Today those are reported and not
  walked; if one turns out to carry a deadline, the expander is where that changes, and the
  `unexpanded` list is what will have said so.
- **Task capture arrives.** [academic-os#70](https://github.com/Jerome-Group/academic-os/issues/70)
  decides where tasks live, and *what's due* reads the calendar until it does. That product already
  serves task tools over MCP on the Tailnet, so the desk may end up reaching them rather than
  growing its own.
- **A second capability needs a desk.** Media's does not — its product owns its tools — but a third
  capability with a CLI and no tool layer would be the second unit of this shape, and two is when
  the shape is worth naming rather than repeating.
