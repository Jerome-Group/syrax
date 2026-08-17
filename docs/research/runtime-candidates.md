# Runtime adapter candidates: Hermes, OpenClaw, and peers

Research for [#5](https://github.com/Jerome-Group/syrax/issues/5). Facts checked against primary
sources on 2026-08-15; star counts and release data move fast, so treat them as a snapshot.

The question: which open-source agent runtime should Syrax's **runtime adapter** (see
`CONTEXT.md`) wrap? The Owner named "Hermes agent" and "OpenClaw"; both resolve to real,
heavily maintained projects, and one credible peer joins them on the shortlist.

## The constraints, restated

From the ticket: 24/7 on a 16 GB Mac mini alongside other workloads (no local chat models);
installs entirely under `/Volumes/RAID0`; Telegram bot support, ideally forum topics;
multi-provider model routing or clean hooks for an external router; MCP tool support; a
single-user security posture; active maintenance; a license compatible with this public MIT
reference repository.

## What the named candidates actually are

**OpenClaw** — [`openclaw/openclaw`](https://github.com/openclaw/openclaw), a TypeScript/Node.js
personal-AI-assistant runtime started by Peter Steinberger and now developed in the open by the
non-profit OpenClaw Foundation ([openclaw.ai](https://openclaw.ai/)). A local **Gateway** process
is the control plane; channels (WhatsApp, Telegram, Discord, Slack, Signal, iMessage, and more)
bring the assistant into existing messengers
([DigitalOcean overview](https://www.digitalocean.com/resources/articles/what-is-openclaw)).

**Hermes Agent** — [`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent),
a Python 3.11 (+ Node.js tooling) self-improving personal agent from Nous Research, launched
25 February 2026 ([hermes-agent.org](https://hermes-agent.org/)). Its distinguishing feature is a
learning loop: it creates skills from experience, curates persistent memory, and searches its own
past sessions. A single gateway process serves Telegram, Discord, Slack, WhatsApp, Signal, and a
CLI/TUI ([README](https://github.com/NousResearch/hermes-agent)).

## Shortlist

### 1. OpenClaw

| Constraint | Finding |
|---|---|
| Mac mini, 16 GB, no local models | Node.js 22.22.3+/24.15+/25.9+; installer provisions Node on macOS. No local model needed; third-party sizing guides put an API-backed install at roughly 2–4 GB RAM ([Cherry Servers](https://www.cherryservers.com/blog/openclaw-hardware-requirements)). |
| Installs under `/Volumes/RAID0` | First-class: point `OPENCLAW_STATE_DIR` (or `OPENCLAW_HOME`) at any path; the state dir holds config, auth, sessions, and channel state, and the [migration guide](https://docs.openclaw.ai/install/migrating) documents the move. |
| Telegram + forum topics | Strongest of the field. Forum supergroups get per-topic session keys (`:topic:<threadId>`), and `channels.telegram.groups.<chatId>.topics.<threadId>` can override skills, prompts, and even route each topic to a different agent via `agentId` — its own workspace, memory, and session ([Telegram docs](https://docs.openclaw.ai/channels/telegram)). |
| Model routing | 40+ provider plugins (Anthropic, OpenAI, Google, OpenRouter, Ollama, custom endpoints); `provider/model` references, ordered fallback chains, multi-key rotation, retry-on-429 failover ([model providers](https://docs.openclaw.ai/concepts/model-providers)). An external router slots in as an OpenAI-compatible provider. |
| MCP | Supported, with an [MCP registry](https://docs.openclaw.ai) for external tools; the ClawHub ecosystem adds thousands of skills ([MCPBundles](https://www.mcpbundles.com/blog/openclaw-mcp-tools)). |
| Single-user security | Gateway binds loopback-only by default with token auth; unknown DM senders get pairing codes (`dmPolicy: "pairing"` default); prompt injection is treated as unsolved rather than hand-waved; optional Docker sandboxing ([security docs](https://docs.openclaw.ai/gateway/security)). |
| Maintenance | ~386k stars; release v2026.7.1-2 on 2026-08-04; pushed daily (GitHub API, 2026-08-15). |
| License | MIT (© OpenClaw Foundation). GitHub reports `NOASSERTION` only because the file appends a pointer to `THIRD_PARTY_NOTICES.md`; the grant text is verbatim MIT ([LICENSE](https://github.com/openclaw/openclaw/blob/main/LICENSE)). |

Risks: the project moves extremely fast (calendar-versioned releases, large surface area), and its
popularity has made misconfigured public gateways a recurring incident theme — the loopback +
pairing defaults, kept, are the mitigation. The skill ecosystem is a supply chain; treat
third-party skills as untrusted input.

#### Measured against the pinned release, 2026-08-17

Everything above is documentation. [#39](https://github.com/Jerome-Group/syrax/issues/39) installed
the exact release [ADR-0003](../adr/0003-the-runtime-adapter-wraps-openclaw.md) pins — `2026.6.34`
from `extended-stable`, still the head of that channel — and put one claim to the API, because
[ADR-0006](../adr/0006-the-runtime-routes-and-syrax-owns-the-escape-hatch.md) hangs the worker lane
on it.

**The sub-agent model override binds, with a custom provider on both sides.** Two providers declared
under `models.providers` with `api: "openai-completions"` — one on Cerebras, one on Z.AI — and the
child ran on the second while the parent ran on the first. It binds from `agents.list[].subagents.model`
and from `agents.defaults.subagents.model` alike, so the split is per-agent configuration and does not
need a global default. Read it back from `sessions_spawn`, which returns `resolvedModel`,
`resolvedProvider` and an undocumented `modelApplied: true` in its tool result.

That metadata is **not** on its own proof: an upstream report has it reading `true` while the run
went elsewhere. What settles it is the request — the runtime logs each outbound call as
`provider=… model=… url=…`, and the child's went to the worker provider's own base URL.

Two further shapes, neither of them obvious from the table above: the per-agent override lives at
`agents.list[].subagents.model` — an `agents.entries.*` path appears in circulation and does not
exist — and a model id containing a slash resolves on the **first** separator, so
`syrax-worker/openai/gpt-oss-120b` is provider `syrax-worker`, model `openai/gpt-oss-120b`. Every
OpenRouter id is shaped that way.

One thing this could not measure. Under `openclaw agent --local` the child's announce back to its
parent fails with `GatewayCredentialsRequiredError`, retries three times and gives up: an embedded
one-shot run has no gateway credentials to open the socket the announce needs. Model routing is
therefore observable without a gateway and **completion delivery is not**, so anything that rests on
the parent seeing the child's result has to be verified against a running gateway.

The Node figure in the table above belongs to `latest`, not to the pin: `2026.6.34` declares
`engines.node: ">=22.19.0"`, where `2026.7.1-2` declares `>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0`.
The mini's Node 26.4.0 satisfies both, so nothing downstream moves.

#### Failover, cooldowns and quota state — measured 2026-08-17

[#45](https://github.com/Jerome-Group/syrax/issues/45) put the four failover facts
[ADR-0006](../adr/0006-the-runtime-routes-and-syrax-owns-the-escape-hatch.md) inferred from
documentation to the pinned release. The row above and ADR-0006's own §"What the runtime already
does" should be read against this section, not on their own.

**A 429 is classified on its HTTP status alone; the provider's error code cannot be reached.** Z.AI's
`1302`, `1305`, `1308` and `1310` all classify as `rate_limit`, and so does an invented `9999`: the
classifier consults the status before the error code, and the code table it would otherwise consult
recognises only symbolic names (`RESOURCE_EXHAUSTED`, `THROTTLED`, …), never a provider's numeric
code. The only text that escapes `rate_limit` at 429 is billing wording. No configuration changes
this, and neither does a provider plugin — the hook that lets a plugin reclassify is honoured at
401/403 and ignored at 429. So ADR-0006's *"the runtime matches the message, not the code"* is wrong
in its mechanism and right in its conclusion, and the conclusion is the stronger one: the
distinction #24 measured is not merely unmatched, it is unreachable.

**A cooled-down rung is probed, not skipped — the unmetered floor is not abandoned.** With 6.8 s
left on a live `rate_limit` cooldown, the next turn logged
`decision=probe_cooldown_candidate … reason=rate_limit` and *succeeded on the cooled-down provider*.
So a `1302`/`1305` costs one rejection and a fail-over **for the turn that was refused**, and does
not take the lane out of service. ADR-0006's *"it will fail over to a finite provider and cool the
unmetered one down for 30 s, escalating to 5 minutes"* overstates the consequence it accepted.

**The cooldown ladder is 30 s → 1 min → 5 min in code, and 30 s in practice.** Not user-configurable,
as ADR-0006 has it: `auth.cooldowns.*` reaches only the billing and permanent-auth lane and the 24-hour
failure window, and nothing feeds the rate-limit ladder (`OPENCLAW_SDK_RETRY_MAX_WAIT_SECONDS` is a
separate SDK retry-after cap). But the higher rungs were never observed — every cooldown measured
~30 s at error counts of 4, 6 and 7 — because an already-active window is **kept rather than
extended**, and any success resets the counter to zero. The runtime's own shipped
`docs/concepts/model-failover.md` claims 1 min → 5 min → 25 min → 1 hour; the code disagrees with its
own documentation, and the code is what runs. Cooldowns are also skipped entirely for two
hard-coded providers, `openrouter` and `kilocode`, so the `:free` tail can never be cooled down.

**A model can be taken out of a chain from outside the runtime, with no restart.**
`openclaw config set agents.defaults.model.fallbacks '[]'` against a running gateway logged
`config hot reload applied (agents.defaults.model.fallbacks)` with the process id unchanged, and the
next turn moved from `next=none` to `next=<the re-added rung>` — the edited chain was live on the
following turn. `agents` and `models` are hot-applying sections; only `gateway.*`, `discovery` and
`plugins` require a restart. The CLI prints *"Restart the gateway to apply"* for this field, which is
wrong, and following it is how a needless restart gets built into a stand-down path. **Stand down is
therefore a config write, not a restart** — which contradicts ADR-0006's
*"no API, no file, no command … takes a model out of service from outside the runtime"* and fires
that record's own *revisit when* trigger. Resetting a **cooldown** is a separate question and closer
to ADR-0006's claim: `models auth login` clears every lockout for a provider, but it is undocumented
and refuses to run without an interactive TTY, while the scriptable `models auth paste-api-key` does
not clear anything.

**Quota state exists only once an auth profile does.** The store is
`<state>/agents/<agentId>/agent/openclaw-agent.sqlite` — reported by `models auth list --json` as
`authStatePath`, and created lazily. Two tables carry it, `auth_profile_store(store_key, store_json,
updated_at)` and `auth_profile_state(state_key, state_json, updated_at)`, with `state_key` = `primary`.
There are **no cooldown columns**: `usageStats` is JSON inside `state_json`, shaped
`{version, lastGood: {provider: profileId}, usageStats: {<profileId>: {lastUsed, cooldownUntil,
cooldownReason, cooldownModel, errorCount, failureCounts: {<reason>: n}, lastFailureAt}}}`. A reader
therefore parses a blob, and an upstream break shows up as a JSON-shape change rather than a missing
column. The load-bearing caveat: under #39's config shape — keys inline as
`models.providers.<id>.apiKey` — **no auth profile is created at all**, failover logs `profile=-`,
the file is never written, and nothing is recorded to read. A profile has to be added deliberately;
doing it with `models auth paste-api-key` also rewrites `openclaw.json` (adding `auth.profiles` and a
`meta` block, leaving a `.bak`) and stores the key in `store_json` **in plaintext** — a third copy of
the secret after `providers.env` and the `models.json` copy #39 found.

### 2. Hermes Agent

| Constraint | Finding |
|---|---|
| Mac mini, 16 GB, no local models | Python 3.11 via `uv`, installer handles all dependencies on macOS; Nous advertises it running on "a $5 VPS", so an API-backed install is modest ([README](https://github.com/NousResearch/hermes-agent)). |
| Installs under `/Volumes/RAID0` | First-class: `HERMES_HOME` relocates the default `~/.hermes` state root (README references `${HERMES_HOME:-$HOME/.hermes}` throughout). |
| Telegram + forum topics | Full support: each topic maps to an isolated session key (`agent:main:telegram:...:{thread_id}`), per-topic skill bindings via `platforms.telegram.extra.group_topics`, topics even work in 1-on-1 DMs; allowlists (`TELEGRAM_ALLOWED_USERS`, `TELEGRAM_GROUP_ALLOWED_CHATS`) plus pairing codes ([Telegram guide](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram)). |
| Model routing | Multi-provider: Nous Portal, OpenRouter, OpenAI, Anthropic, any OpenAI-compatible endpoint; switch per session with `/model provider:model`, no lock-in ([providers](https://hermes-agent.nousresearch.com/docs/integrations/providers)). Automatic failover is less prominent than OpenClaw's fallback chains. |
| MCP | "Connect any MCP server"; also implements the agentskills.io skill standard ([MCP docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp)). |
| Single-user security | DM pairing with approval (`hermes pairing approve`), allowlists, command approval, container-hardening guidance; zero-telemetry stance ([messaging guide](https://hermes-agent.nousresearch.com/docs/user-guide/messaging)). |
| Maintenance | ~230k stars; v0.20.1 released 2026-08-13; pushed daily (GitHub API, 2026-08-15). |
| License | MIT ([repo](https://github.com/NousResearch/hermes-agent)). |

Distinctives: the built-in memory/learning loop (agent-curated memory, autonomous skill creation,
FTS5 session search, Honcho user modeling) is genuinely differentiated — it overlaps with what
Syrax might otherwise build itself, which cuts both ways: less to build, more behavior owned by
the runtime rather than by Syrax's contract. Risks: younger than OpenClaw (launched Feb 2026,
0.x versioning) and Python-based, so its dependency surface is larger than a single binary.

### 3. ZeroClaw (lightweight fallback)

| Constraint | Finding |
|---|---|
| Mac mini, 16 GB | Best of the field: a single Rust binary; ~20 providers, 30+ channels, MCP tools ([README](https://github.com/zeroclaw-labs/zeroclaw)). |
| Installs under `/Volumes/RAID0` | Weakest of the three: config home is `~/.zeroclaw/config.toml` and no relocation environment variable is documented — a gap that would need a symlink or upstream change. |
| Telegram + forum topics | Thread-aware (`message_thread_id` handled in `crates/zeroclaw-channels/src/telegram.rs`) with peer-group authorization and pairing, but no documented per-topic sessions or per-topic agent routing ([Telegram docs](https://github.com/zeroclaw-labs/zeroclaw/blob/main/docs/book/src/channels/telegram.md)). |
| Model routing | Pluggable providers with documented fallback chains and routing ([README](https://github.com/zeroclaw-labs/zeroclaw)). |
| MCP | Custom MCP servers supported as tools. |
| Single-user security | Most conservative defaults: `supervised` autonomy (medium-risk ops need approval), workspace boundaries, macOS Seatbelt sandboxing, cryptographic tool receipts, encrypted token storage. |
| Maintenance | ~32.6k stars; v0.8.4 on 2026-08-02; pushed daily. Pre-1.0. |
| License | MIT OR Apache-2.0, contributor's choice — compatible. |

Keep ZeroClaw in view as the footprint-first fallback if the Node/Python runtimes prove too heavy
next to the mini's other workloads; today its Telegram topics and state-relocation stories are
behind the other two.

## Peers considered and excluded

- **NanoClaw** ([`nanocoai/nanoclaw`](https://github.com/nanocoai/nanoclaw), ~30.5k stars, MIT) —
  a deliberately tiny Claude Agent SDK host that isolates agents in Docker containers; Telegram
  arrives via an `/add-telegram` fork skill. Excluded: Docker Desktop's VM is a poor tenant on a
  shared 16 GB mini, it is Anthropic-first by design, and its fork-and-customize model fits a
  bespoke install better than a runtime adapter contract.
- **TrustClaw** ([`ComposioHQ/trustclaw`](https://github.com/ComposioHQ/trustclaw), ~0.9k stars) —
  vendor-tied to Composio's hosted tool platform; community too small for a 24/7 dependency.
- **microclaw / nanoclaw-py** — sub-1k-star rewrites; too young to carry the system.
- **Hosted agents** (Manus, Perplexity Computer, and peers in the
  [comparison literature](https://composio.dev/content/openclaw-alternatives)) — excluded by the
  self-hosted constraint.

## Recommendation

**Wrap OpenClaw first. Keep Hermes Agent as the named alternative, ZeroClaw as the
footprint fallback.**

OpenClaw is the only candidate that is best-in-field on the two constraints Syrax's shape cares
most about: Telegram forum topics (per-topic *agent* routing, not just per-topic sessions — each
topic can carry its own workspace, memory, and system prompt, which maps directly onto Syrax's
orchestration contract) and model routing (ordered fallback chains, key rotation, 40+ providers,
or an external router as an OpenAI-compatible endpoint). It also has the cleanest answer to the
`/Volumes/RAID0` constraint (`OPENCLAW_STATE_DIR`), a loopback-plus-pairing default posture built
for exactly one user, MCP support, MIT licensing, and the largest maintenance base of any project
in this space.

The costs are churn and attack surface: pin a release, keep the gateway loopback-bound, leave
`dmPolicy: pairing` on, and treat ClawHub skills as untrusted third-party code. All of the
runtime's private state (sessions, memory, channel auth) is **private runtime state** in this
repository's sense and lives under the relocated state dir, outside any committable path.

Choose Hermes instead if the decision ticket weighs a built-in memory/learning loop above
ecosystem breadth and topic-level agent routing — it satisfies every hard constraint and its
memory story is the strongest. Nothing here is one-way: the runtime adapter boundary exists so
the concrete runtime can be swapped, and the decision itself belongs in a new `docs/adr/` record
when it is made.
