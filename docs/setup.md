# Setup

This repository is currently documentation-first. It does not yet select or install a concrete
agent runtime, so there is no honest run command to copy and no dependency set to install.

## Safe setup sequence

1. Read [system-overview.md](system-overview.md) and [configuration.md](configuration.md).
2. Choose or implement a runtime adapter, then record the choice and license boundary in a new ADR.
3. Copy [the example configuration](../config/syrax.example.toml) to a local configuration path
   outside version control, replacing placeholders only on the private machine.
4. Inject provider credentials through the environment or a private secret store. Never put them in
   the copied configuration, shell history, or tracked files.
5. Keep private state, chat archives, memory, caches, logs, and browser sessions outside this
   repository. Use a least-privilege tool allowlist and a separate test account where possible.
6. Before committing a change, inspect the staged file list and search it for credentials, private
   conversations, machine-specific paths, and provider responses.

## Runtime adapter checklist

An adapter is ready for a setup guide only when it can state:

- the exact runtime and version;
- the install, start, test, and stop commands;
- where secrets are read from;
- which tools are enabled by default;
- where state is written and how it is kept outside this repository;
- how a clean test run proves the adapter works without a private account.

Until those answers exist, this file intentionally stops at the boundary rather than presenting a
plausible-looking command for a runtime Syrax has not chosen.
