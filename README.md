# Syrax

Syrax is the public, MIT-licensed reference repository for my personal chatbot system: how its
pieces fit together, how it is set up, and which runtime boundaries keep private state private.
It is intended for people who want to understand, run, or adapt the system.

A [Jerome-Group](https://github.com/Jerome-Group) repository. Start with [`MAP.md`](MAP.md) for
the layout and [`AGENTS.md`](AGENTS.md) for the working rules.

## Status

🚶 **Four chats standing.** One bot locked to a single Telegram account, carrying **General**,
**Academic**, **Media** and **System** as a capability boundary each, with the front lane answering
all four and the write path recreating a chat's topic the moment a send finds it cleared. The
runtime is OpenClaw, pinned to an exact version and installed outside this checkout; the adapter
that configures it, and the suite that proves the reply path against a local stub of each wire, are
here. Worker delegation, file search, the lane monitor and the academic desk are implemented. The full
Media capability and a fresh end-to-end acceptance run remain tracked work; see
[setup prerequisites](docs/setup.md#before-you-start) before attempting a deployment.

## What is here

- [`docs/system-overview.md`](docs/system-overview.md) — the components, data flow, and public/private boundary.
- [`docs/providers.md`](docs/providers.md) — provider accounts, API-key placement, model chains and credential checks.
- [`docs/setup.md`](docs/setup.md) — the safe setup sequence and the checks before a runtime is launched.
- [`docs/configuration.md`](docs/configuration.md) — the configuration contract and placeholder example.
- [`config/syrax.example.toml`](config/syrax.example.toml) — illustrative public configuration, not a live file.
- [`src/adapter/`](src/adapter/) — Syrax's decisions as one generated runtime configuration.
- [`src/supervision/`](src/supervision/) — the LaunchAgent and the wrapper's pre-flight, generated the same way.
- [`runtime/package.json`](runtime/package.json) — the runtime pin, whose lockfile is the pin itself.
- [`docs/adr/`](docs/adr/) — decisions that cannot be recovered from the future code alone.

## Getting started

You supply your own provider accounts and Telegram bot. This is a macOS LaunchAgent setup and
currently requires the academic-os and ntulearn integrations. For the exact key template and
account links, read [Providers and credentials](docs/providers.md).

Read the overview first, then follow [`docs/setup.md`](docs/setup.md): install the pinned runtime
outside the checkout, write the secrets store, describe the machine, generate the runtime's
configuration, then install the LaunchAgent that supervises it. `SYRAX_RUNTIME_ROOT="$RUNTIME_ROOT" npm test` exercises the reply path against local stubs
with no external call and no quota spent; without that variable, gateway-backed tests skip.

## Public boundary

The repository may contain source, architecture, setup instructions, and sanitised examples. It
must not contain API keys, OAuth or browser sessions, private chats, private memory, provider
responses, machine-specific paths, runtime caches, or logs carrying those values. Keep the private
runtime root outside this checkout; `.gitignore` is a backstop, not a substitute for that boundary.

## License

Syrax is MIT licensed. The license covers the project's own code and documentation only; runtimes,
models, prompts, and other dependencies retain their own terms. See
[`docs/adr/0002-the-public-boundary-and-mit-license.md`](docs/adr/0002-the-public-boundary-and-mit-license.md)
for the decision behind the grant.
