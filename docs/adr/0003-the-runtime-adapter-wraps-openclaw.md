# The runtime adapter wraps OpenClaw

> **Amended by [ADR-0005](0005-launchd-supervises-syrax-as-two-launchagents.md)** on the footprint
> budget, and by [ADR-0011](0011-the-front-lane-carries-no-skills-and-a-pinned-workspace.md) on the
> skill posture, which widens the empty allowlist to cover the runtime's own bundled catalogue.

Syrax's **runtime adapter** wraps [OpenClaw](https://github.com/openclaw/openclaw), pinned to its
`extended-stable` release channel. Hermes Agent and ZeroClaw were the other two candidates on the
research shortlist ([`docs/research/runtime-candidates.md`](../research/runtime-candidates.md));
Hermes is the named alternative and ZeroClaw the footprint fallback. [ADR-0002](0002-the-public-boundary-and-mit-license.md)
deferred this choice on purpose, and this record is the decision it deferred to.

## What decided it

Not the candidate's size or its star count, but a prior decision about the division of labour: the
runtime owns routing and session plumbing, and Syrax owns which tools each chat may reach and what
it says. That division makes one feature load-bearing — per-topic **agent** routing, where each
Telegram topic carries its own workspace, system prompt and session.

That matters because a chat here is a capability boundary rather than a filing convenience: which
chat a message arrives in determines the reachable tool layer, the retrieval scope and the session
state. OpenClaw expresses precisely that as configuration, one agent per topic. The alternative is
to build the same boundary inside Syrax, which is to rebuild the runtime that was just chosen.

Hermes Agent satisfies every hard constraint and its per-topic sessions come one level short of
per-topic agents, but the gap would have been covered by its distinguishing feature — a learning
loop that curates its own memory and writes its own skills from experience. Under this system's
standing constraint that agents do nothing more and nothing less than what they are configured
for, a runtime that invents its own skills is a liability rather than an asset, and memory is
explicitly not a v1 goal. Discounting the loop leaves Hermes behind on the criterion that decided
the question.

ZeroClaw is the lightest of the three by a wide margin, and if footprint were a hard constraint it
would win. It documents neither per-topic sessions nor a variable that relocates its state root,
and those are two of this system's constraints rather than preferences.

## The adapter is a configuration contract, not a code layer

The runtime adapter is the OpenClaw configuration that expresses Syrax's chats as per-topic
agents, the launch and state contract that keeps every byte of private runtime state under
`OPENCLAW_STATE_DIR` on the external volume, and the MCP servers Syrax writes for itself. It is
deliberately **not** an abstraction over the runtime's API.

A wrapper written to make the runtime swappable is the standard mistake here, and it fails twice:
it makes the runtime's own features unreachable except through whatever the wrapper anticipated,
and it grows into the thing that has to be rewritten when the runtime is replaced. Reversibility
comes from the contract being small, documented and boring — not from an indirection.

## What is pinned

The pin is an exact version taken from the `extended-stable` channel — `2026.6.34` at the time of
writing, against a `latest` of `2026.7.1-2`. OpenClaw ships calendar-versioned releases at a pace
measured in days, so the channel is what upstream considers settled and the exact pin is what
stops an upgrade from happening unattended. Upgrading is a deliberate change with a diff and a
pull request. How the pin is supervised and rolled forward is a deployment question, not this one.

Node 26.4.0 on the mini satisfies the package's declared `engines`, whose final clause is
open-ended (`>=25.9.0`); the runtime's own installer can provision Node independently if that
stops being true.

## The tool layer carries no third-party skills

OpenClaw's skill ecosystem, ClawHub, does not come along with this decision. The tool layer is
exactly each capability product's own tools plus the MCP servers Syrax writes; the third-party
allowlist is empty.

This is a survey result, not only a principle. At the time of writing the marketplace's featured
skills are general-purpose developer and office utilities with download counts in the tens to low
hundreds — too thin to carry a 24/7 dependency — and none of them covers anything Syrax actually
needs: no usage or quota tracking, no context trimming, no local document indexing. Telegram
support, provider routing and per-topic agents are core runtime features rather than skills, so
their absence from the marketplace is not a gap. The one popular entry whose description sounds
relevant is a self-improving agent that captures its own learnings, which is the same behaviour
this decision declined when it set Hermes aside.

Skills are third-party code running with the assistant's reach. An empty allowlist is the posture;
adding to it is a decision, with the supply-chain argument made at the time.

## The footprint budget

The mini has 16 GB shared with other workloads, and an API-backed OpenClaw install is sized at
roughly 2–4 GB resident against ZeroClaw's single Rust binary. The budget is a steady-state
resident set of **4 GB** for the gateway.

Exceeding it triggers a re-evaluation with measurements in hand — it does not automatically swap
the runtime out. The distinction is the point: the budget exists to force the question to be
reopened with real numbers rather than to make an irreversible choice on an estimate. Measuring
the steady-state figure under real load belongs to the deployment decision.

## Consequences

- The four chats are expressed as OpenClaw per-topic agents in configuration, and the tracked
  example of that configuration is public with placeholders, as every tracked example here is.
- All private runtime state — sessions, channel auth, memory, caches — lives under the relocated
  state directory on the external volume, outside any committable path.
- The gateway keeps its shipped defaults of loopback binding and DM pairing; they are already a
  single-user posture, and this system has exactly one user.
- Syrax builds no platform adapter of its own. The runtime brings its own channels, so a second
  messaging platform is a runtime capability rather than Syrax code, and the constraint that
  survives is that the runtime must not be single-channel.
- An external provider router, if one is chosen, attaches as an OpenAI-compatible provider rather
  than as a fork of the runtime's routing.

## Revisit when

- The gateway's measured steady-state resident set exceeds the 4 GB budget.
- Per-topic agent routing changes shape upstream, or the `extended-stable` channel is withdrawn.
- A third-party skill is proposed, which reopens the empty-allowlist posture rather than assuming
  it.
- Memory becomes a goal, which is the point at which Hermes Agent's learning loop is worth
  reconsidering on its merits.
