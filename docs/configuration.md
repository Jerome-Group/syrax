# Configuration

[The example configuration](../config/syrax.example.toml) is a public interface sketch. It names
the decisions a deployment must make without pretending that the current repository already parses
the file. A runtime adapter may translate this contract into its own configuration, but it must
keep the boundary intact.

| Section | Meaning | Public value |
|---------|---------|--------------|
| runtime | The selected adapter and executable entrypoint | Placeholder until a runtime is chosen |
| model | Provider and model selection | Names only; credentials stay outside the file |
| paths | Roots for private state, chat archives, the search index and its benchmark | Absolute paths outside this repository |
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
