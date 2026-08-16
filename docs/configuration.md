# Configuration

[The example configuration](../config/syrax.example.toml) is a public interface sketch. It names
the decisions a deployment must make without pretending that the current repository already parses
the file. A runtime adapter may translate this contract into its own configuration, but it must
keep the boundary intact.

| Section | Meaning | Public value |
|---------|---------|--------------|
| runtime | The selected adapter and executable entrypoint | Placeholder until a runtime is chosen |
| model | Provider and model selection | Names only; credentials stay outside the file |
| paths | Roots for private state, chat archives, the search index, its benchmark and the logs | Absolute paths outside this repository |
| security | Secret source and tool policy | Environment/private store plus explicit allowlist |
| observability | Log and trace handling | Sanitised local output by default |

## Local configuration

Use a filename matching config/*.local.* or config/*.secret.*; those patterns are ignored. A local
file is still not automatically safe: keep its parent directory private, inspect the diff before
every commit, and prefer environment variables or a dedicated secret store for credentials.

## State placement

The runtime state path must not be a child of this repository. This includes chat history, memory,
browser sessions, caches, databases, logs, and provider responses. A path outside the checkout
means a broad git add cannot accidentally turn a live session into a public commit.

The **search index** belongs to the same category and is the largest member of it: it holds the
extracted text of private documents verbatim, in a full-text table, and is measured in hundreds of
megabytes. An ignore rule is not the control here — it stops an accidental `git add` and nothing
else, and this repository states its rule as placement. Give it its own path beside the runtime's
state directory rather than inside it, so that re-pinning or resetting the runtime does not discard
an index that costs hours of embedding to rebuild. [ADR-0004](adr/0004-syrax-owns-the-file-search-index.md)
carries the reasoning.

## The two units

Syrax is supervised as two launchd LaunchAgents rather than one process or a container.
[ADR-0005](adr/0005-launchd-supervises-syrax-as-two-launchagents.md) carries the reasoning; what
matters for configuring a deployment is that they are separate on purpose.

| Unit | What it runs | Why it is its own unit |
|------|--------------|------------------------|
| `com.jerome-group.syrax.gateway` | The agent runtime | It holds the sessions and carries every chat |
| `com.jerome-group.syrax.search` | The resident search service | One embedder in memory regardless of how many agents connect |

The second is the one that is easy to get wrong. The usual MCP transport has each client spawn the
server as a child process, which would put one resident embedding model behind **every** agent. The
search service is therefore standalone and bound to loopback, and the agents connect to it — so the
model is loaded once and survives a gateway restart.

Both units are launched through a wrapper script rather than the binary. The wrapper is what sources
the secrets file and sets the `PATH` a supervisor does not provide; putting credentials in the unit
definition itself would leave live keys in plaintext in a file that is otherwise a tracked example.

Every wall-clock schedule — the index passes and the morning brief — is a launchd calendar job that
pokes a loopback endpoint, rather than being split between launchd and the runtime's own scheduler.
That keeps one auditable answer to *what can message me unprompted*.

## Logs

Logs go to the `logs` path, outside the checkout with the other private roots, because gateway logs
contain **chat content** — private runtime state by the same definition as the chat archive.

**Rotate them.** A supervisor's output redirection appends without bound, so rotation is a
`newsyslog.d` entry rather than something to be remembered. If the volume holding the logs is not
mounted, the job cannot open its log and fails loudly, which is the correct failure: the runtime's
state directory is on that volume anyway.

## Rolling the runtime pin forward

The runtime is pinned to an exact version, and **the lockfile is the pin**. A tracked
`runtime/package.json` and `runtime/package-lock.json` are installed with `npm ci --prefix` into a
runtime root **outside the checkout**, so the installed tree is never a candidate for a commit.

Rolling forward is deliberate, in this order:

1. Open a pull request bumping the version string, so the change has a diff and a review. The
   lockfile makes the transitive surface diffable too, which matters more than the top-level pin on
   a project that ships releases every few days.
2. `npm ci --prefix <runtime root>` to install from the merged lockfile.
3. `launchctl kickstart -k` the gateway unit.

A global install or a version-resolving runner would work and is not used: neither produces a diff
anybody can review, which is the whole point of pinning.

## Rebuilding and resetting the index

Three operations, and which one to reach for depends on what went wrong.

| Operation | What it does | When |
|-----------|--------------|------|
| Incremental pass | Re-reads documents whose size or modification time changed | Hourly, unattended |
| Full pass | Re-reads every document in the extraction scope, re-embedding only where the extracted text changed | Every third day, unattended; by hand after a document is known to have broken |
| Reset | Deletes the index and rebuilds from nothing | After changing the embedder, the chunking, or the extraction scope — each invalidates every stored vector |

A reset is safe to run at any time: the index is derived state, and nothing else reads from it. It
costs a full re-embedding of the corpus, which is the only expensive part of any of this.

Extraction failures are recorded rather than dropped. Each failed document lands in a **failure
ledger** beside the index, which the full pass retries and which is reportable in chat — a document
that cannot be read is a fact worth surfacing, not a silent gap in what search can find.
