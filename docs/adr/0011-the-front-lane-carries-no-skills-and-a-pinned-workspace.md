# The front lane carries no skills, and its workspace is pinned

> **Amended by [ADR-0016](0016-the-lanes-are-recomposed-on-failure-rate-and-the-front-lane-is-told-not-to-guess.md) in one part.** The workspace is no longer empty — it carries an
> `AGENTS.md` holding the front lane's standing instruction — so the prompt cost below rises and
> the line *"there is nothing left to inject"* no longer holds. The four settings are unchanged.

Syrax's standing runtime configuration is four lines, and the prompt they produce costs **~2,900
tokens per turn**:

| Setting | Value |
|---|---|
| `agents.defaults.skills` | `[]` |
| `agents.defaults.workspace` | an explicit path under the runtime root |
| `agents.defaults.skipBootstrap` | `true` |
| `tools.profile` | `"minimal"` |

Three of them were a prototype's argument list until now. The first was never set at all, and is the
largest of the four by a wide margin.

## The residual was mostly a catalogue nobody meant to ship

[#56](https://github.com/Jerome-Group/syrax/issues/56) cut a stock 11,003-token turn to 6,115 with
configuration alone and recorded the remainder as *OpenClaw's own system prompt plus the surviving
tool schemas*. Every run #56 and [#39](https://github.com/Jerome-Group/syrax/issues/39) captured
already carried a `systemPromptReport` block, and twenty of them agree that this is wrong in the one
direction that mattered:

| | stock (11,003 tok) | lean (6,115 tok) |
|---|---|---|
| system prompt chars | 36,339 | 21,015 |
| — of which **bundled skills catalogue** | **11,926** | **11,926** |
| — of which the runtime's own prompt | ~23,500 | **~8,200** |
| tool schema chars | 8,004 (8 tools) | 1,422 (4 tools) |

The 49% cut deleted the seeded workspace and four tool schemas and **left the single largest block
untouched**, invariant to the byte across both configurations and both lanes. At the measured 3.67
characters per token that block is **~3,250 tokens, 53% of the lean turn**, and it is a catalogue of
**31 skills** — `code-review`, `tdd`, `tmux`, `browser-automation`, `notion`, `meme-maker`,
`skill-creator`. Read as a list it is an agent-coding toolkit: skills for an agent working in a
repository, not for the Owner asking Media for a film.

## Zeroing it removes a description, not a power

This is why it is a defect being closed rather than a capability being traded.
[ADR-0003](0003-the-runtime-adapter-wraps-openclaw.md) set the skill allowlist **empty** — but it
argued that about ClawHub, and these 31 ship inside the package, so the posture never reached them.
**This record widens it to cover the runtime's own bundled catalogue.**

A skill grants no reach of its own. Every capability it describes is reached through the tool layer,
which is where this system's boundary was drawn in the first place — so a catalogue advertising
browser automation to an agent with four tools is a cost with nothing on the other side of it. It was
also failing the standing constraint that agents do nothing more than what they are configured for,
quietly, on every turn.

`filterSkillEntries` makes the empty list an explicit branch rather than a happy accident — the
filter reads *if the list is non-empty, allow those; otherwise allow none* — and it preserves *unset*
as distinct from *empty* throughout.

## What the prompt actually costs, and why it is capacity rather than tidiness

#56 found that Cerebras' binding rung is **tokens-day**: every prompt token is charged on every call,
cached ones included. So prompt size *is* the front lane's daily capacity, near enough exactly:

| Per-turn prompt | Turns/day on Cerebras' 1,000,000 |
|---|---|
| 11,003 (stock) | ~90 |
| 6,115 (lean, skills included) | ~163 |
| **~2,900 (standing configuration)** | **~340** |

The floor beneath that is the runtime's own prompt at ~8,200 characters ≈ ~2,050 tokens, which is not
configurable and is deliberately not pursued.

**This is not a budget.** [#13](https://github.com/Jerome-Group/syrax/issues/13) decided there is
none, and that decision stands: it ruled out a self-imposed *allowance on spending*, where this is
the fixed cost of a configuration. The distinction is worth holding because calling it a budget is
how it would acquire a checker, and then something would sit on the request path counting turns —
which [ADR-0009](0009-the-chains-are-recomposed-and-stand-down-is-a-config-write.md) spent a whole
ticket ruling out. So it is recorded in that record's shape, as an invariant with no enforcement:

> **The front lane's standing configuration costs ~2,900 prompt tokens per turn, and a change that
> raises it is a change to daily capacity.**

## `promptOverlays` cannot cut anything, and is closed on the source

#67 asked whether it was worth measuring. It is not, and no measurement is needed. The setting is
marked `@deprecated`; it only ever *adds* text — a behaviour contract plus an interaction-style
section; and it fires only where the model id matches `/(?:^|[/:])gpt-5(?:[.-]|$)/i`, which
`gpt-oss-120b`, `glm-4.5-flash`, `gemini-3.5-flash-lite` and `mistral-*` all fail. Its only reachable
setting suppresses one of the two blocks it would have added had it applied at all.

## The workspace line is load-bearing twice

Unset, the pinned runtime writes its workspace to **`~/.openclaw/workspace`** — the internal disk —
with `OPENCLAW_STATE_DIR` correctly pointed at `/Volumes/RAID0`, because the state dir and the
workspace are **separate settings and only the first had been set**. That is the standing *everything
under `/Volumes/RAID0`* constraint broken by a default.

**This amends [ADR-0005](0005-launchd-supervises-syrax-as-two-launchagents.md)**, whose state
placement is otherwise complete: the workspace is a second path the runtime chooses for itself, and
it needs naming alongside the state dir rather than being assumed to follow it.

#56 judged this a line of configuration rather than a decision and left it in a comment. That
judgement is the reason it is recorded here — a constraint broken by a default is exactly the thing
that survives in a comment and dies in a redeploy.

## The sub-agent splits, and its tools are not cut

Its **skills half is identical** — the same 11,926 characters, in every captured sub-agent run — so
`agents.defaults` zeroes both lanes at once.

Its **tool half is not**. A sub-agent's first call is 13.2–13.4K tokens because the full tool schemas
dominate, and those schemas are the thing the worker exists to do. ADR-0009 already answers the
consequence in chain composition — a rung's ceiling must exceed its lane's largest single call — which
is how Groq left the worker lane. Cutting the worker's tools would be answering a composition question
by making the worker weaker.

## Two knobs weighed and skipped

`contextInjection: "continuation-skip"` skips bootstrap-file injection on safe continuation turns,
which is worth little once the workspace is empty — there is nothing left to inject.
`experimental.localModelLean` drops heavyweight default tools, which `tools.profile: "minimal"`
already does on the front. Both are recorded as considered so they are not rediscovered as
oversights.

## Consequences

- **No behavioural measurement was taken before shipping.** An A/B over 31 unusable skills would
  spend real Cerebras tokens to measure the absence of an effect; the usage and retrieval reports are
  the observation. If the front lane behaves worse without the catalogue, that will surface in use.
- The decision is **cheap to reverse**, by construction rather than by promise. The runtime already
  loads skill bodies on demand — 141,056 characters on disk against 11,926 in the prompt — `skills`
  resolves **per agent**, with a per-agent list winning whenever the key is present, and
  `skills.load.extraDirs` reaches a Syrax-owned root without copying anything in. A skill added later
  costs ~380 characters in the one agent that gets it.
- The empty list lives on `agents.defaults` alone. Setting it per agent would mean four places to
  keep in step and a new chat defaulting back to 31.
- **Per-request selection over a skill index is out of scope for v1** and recorded as such on the
  map. The runtime's own `toolSearch` compacts *tool* catalogues only, so it is something Syrax would
  build rather than configure — and at zero skills there is no catalogue to search.

## Revisit when

- **A skill is proposed for any agent.** The per-agent list is the opt-in, and it reopens the widened
  posture rather than assuming it — ADR-0003's own *revisit when* line, now covering bundled skills
  as well as third-party ones.
- **The pin moves.** Both the catalogue's size and the `skills` filter's treatment of an empty list
  are properties of the pinned version, and neither is contractual.
- **The measured floor moves enough to change the turns/day above.** The invariant states a number,
  and a number that has drifted is worse than none.
