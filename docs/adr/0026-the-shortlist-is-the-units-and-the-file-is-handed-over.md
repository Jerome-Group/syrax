# The shortlist is the search unit's, and the file is handed over rather than reached for

Broad search is the first capability where an answer is not text. General sends a **document**, and
on a close call it sends **three buttons**, and a tap on one has to come back and mean something.
None of that is expressible in a reply's text, so this is the first place where
[ADR-0003](0003-the-runtime-adapter-wraps-openclaw.md)'s boundary — a configuration contract, no
code on the request path — has to be held against a surface rather than against a chain.

Everything below was measured against `openclaw@2026.6.34` as installed, driving the pinned gateway
at the Telegram wire; `test/broad-search.test.ts` is the same measurement kept running.

## The tap is an ordinary message, and the shortlist is the unit's

The runtime's Telegram channel already answers a `callback_query` **before** it does anything else,
unconditionally, and then delivers the tap to the agent that owns the topic it happened in — as a
message whose text is `callback_data: <value>`. So #125's *the callback is acknowledged before the
work its tap triggers* is a property of the runtime rather than something Syrax builds, and the tap
arrives inside the capability boundary rather than beside it.

That leaves one question: **what turns a value back into a document?** The value is all a tap
carries — `callback_data` is sixty-four bytes — so it cannot be a path, and the alternative to a
token is the model reading its own transcript for what it offered a while ago. That is a file
chosen by a model, which is the thing broad search exists not to do.

So the **search unit mints the shortlist and is the only thing that can resolve it**. `search`
returns a `choice` value per candidate on `ambiguous` and one for *none of these*; `choose` takes a
value back and answers `chosen`, `declined` or `expired`. The shortlist is held in memory under a
fifteen-minute lifetime, for the reason ephemeral extraction is: nothing has to decide when deleting
it is safe, and a restart purges by construction.

**`expired` is one answer where the history is several.** Aged out, minted by a process that has
since died, malformed, or offered to a chat whose scope this connection does not carry — all
different pasts and the same present: this chat has no such shortlist, nothing is sent, and the
Owner's next move is to ask again. Reporting them apart would put a fact about Syrax's uptime, or
about another chat's corpus, in a reply about the Owner's documents.

**A tap is scoped the way the search that produced it was.** `choose` reads the same
`X-Syrax-Scope` header `search` does and refuses a token minted under a different one. Nothing on
the surface can carry a tap across chats — the message a tap belongs to lives in one topic — but a
boundary that holds only because the transport happens not to cross it is not a boundary.
`attach` is deliberately **not** scoped, for the same reason `read` is not: the index allowlist is a
compute budget and the blocklist is the boundary, and story 14 wants General reaching a capability's
documents without reaching its tools.

## The document is handed over, because reaching for it costs the blocklist

The runtime uploads a local file only from roots it owns — its state directory, its scratch root,
the calling agent's workspace. Any other path is refused outright: *local media path is not under an
allowed directory*. There is exactly one way to widen that, and it is the trap: **when the agent's
own tool policy carries a filesystem `read`, the allowlist expands to wherever the source lives.**

Taking that door would hand the model a general file read, and
[ADR-0004](0004-syrax-owns-the-file-search-index.md)'s blocklist would stop being a boundary — the
unit's refusals would guard `search` and `read` while the agent walked past them with the runtime's.
The blocklist is the one list that says what may never be touched *anywhere on the machine*, and it
is worth more than a convenience.

So the unit hands the document over instead. **`attach`** applies exactly `read`'s refusals —
blocklist, symlink, not a file — and links or copies the document into a staging root under the
runtime's own state, returning the staged path. The model never holds a filesystem: it holds one
path this unit chose, to one document this unit already agreed to open. Staged handovers are swept
on the same beat as the reader's held text.

`<stateDir>/media` is not a free choice of location; it is the one root the runtime always allows
that belongs to neither an agent nor a scratch sweeper.

## Retrieval scope is a connection, and the tool list is per agent

A chat's scope is bound to **its own MCP connection** — one `mcp.servers` entry per chat that
searches, carrying `X-Syrax-Scope` — and each agent's `tools.alsoAllow` names only that connection's
tools. General's connection carries no scope and reaches the whole index allowlist; Academic's
carries its own; Media and System have no connection at all. A scope a model could name is a scope a
model could widen, and the unit refuses a scope it does not recognise rather than widening it.

Two findings sit under that, both measured and neither guessable:

- **`tools.profile: "minimal"` hides everything an MCP server serves**, so the tools are named back
  in. That is the same move ADR-0011 already made for the delegation tools.
- **A per-agent `alsoAllow` replaces the standing one rather than adding to it.** The two chats that
  named only their own search tools came back with `sessions_spawn`, `sessions_yield` and
  `subagents` gone — a front lane that answers everything itself, and no error anywhere. So every
  agent's list is composed rather than inherited, in `src/adapter/agent-tools.ts`.

Because the runtime refuses to route a scope with no root behind it only at the first query, the
generator refuses to write one at all: a chat that would search nothing is a chat that answers
nothing and says why nowhere.

## The keyboard rule is an instruction, and that is the honest shape

*Every edit to a keyboard-bearing message re-passes the keyboard* is a rule about a surface the
model drives, so it lives in the standing instruction and not in a wrapper — a wrapper is the
request-path code ADR-0003 forbids. **Every** chat is told, not only the ones that search: a rotted
rung's *remove it* tap belongs to System (ADR-0012), and it is the same trap.

What is not left to prose is the fact underneath it, which is measured both ways: an edit carrying
its buttons keeps them, and an edit without them silently returns a message with no keyboard at
all. If the runtime ever stops dropping them, the test that asserts the drop fails and the
instruction stops being load-bearing.

## Consequences

- **General can send a file, and every chat that searches can.** The `message` tool is allowed
  wherever `attach` is, because a document and a keyboard are the two things a search answers with
  and neither fits in reply text.
- **The Academic chat is wired to its scope now**, ahead of
  [#130](https://github.com/Jerome-Group/syrax/issues/130) making that chat live. A scope binding
  with one chat in it is not a binding, and the header would have gone untested.
- **A deployment must name a root for every scope a chat carries.** `searchScopes.academic` is now
  load-bearing rather than illustrative, and `config/deployment.example.json` already carried it.
- **The search unit writes into the runtime's state directory.** One directory and one purpose, and
  the price of not giving a model a filesystem.
- **A tap that arrives after a restart says the shortlist expired.** The unit is a LaunchAgent with
  `KeepAlive`, so this is rare and correct rather than rare and wrong.

## Revisit when

- **The pinned runtime moves.** Four of this record's facts are properties of `2026.6.34`: the
  unconditional callback acknowledgement, the `callback_data:` synthetic message, the media root
  allowlist and its `read`-shaped expansion, and the per-agent `alsoAllow` replacement.
  `test/broad-search.test.ts` and `test/search-connections.test.ts` are the cheapest checks against
  a new pin.
- **A second chat wants a shortlist.** Nothing here is General's: the shortlist, the handover and
  the instruction are all keyed on a chat that searches, and Academic already has all three.
- **A handover outlives its usefulness.** The staging sweep runs on the idle beat, so a document
  sent once sits in the state directory until it fires. If that ever matters — a very large
  document, or a machine short of space — the sweep is the place, not the tool.
- **[#126](https://github.com/Jerome-Group/syrax/issues/126) captures the *none of these* tap.** It
  wants the verdict and the scores as they stood, and a shortlist held in memory holds the
  candidates and not those. That is the first thing that will ask this record whether the shortlist
  should be written down after all.
