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
here. The worker lane, the capability tool layers and the search index are still ahead.

## What is here

- [`docs/system-overview.md`](docs/system-overview.md) — the components, data flow, and public/private boundary.
- [`docs/setup.md`](docs/setup.md) — the safe setup sequence and the checks before a runtime is launched.
- [`docs/configuration.md`](docs/configuration.md) — the configuration contract and placeholder example.
- [`config/syrax.example.toml`](config/syrax.example.toml) — illustrative public configuration, not a live file.
- [`src/adapter/`](src/adapter/) — Syrax's decisions as one generated runtime configuration.
- [`src/supervision/`](src/supervision/) — the LaunchAgent and the wrapper's pre-flight, generated the same way.
- [`runtime/package.json`](runtime/package.json) — the runtime pin, whose lockfile is the pin itself.
- [`docs/adr/`](docs/adr/) — decisions that cannot be recovered from the future code alone.

## Getting started

Read the overview first, then follow [`docs/setup.md`](docs/setup.md): install the pinned runtime
outside the checkout, write the secrets store, describe the machine, generate the runtime's
configuration, then install the LaunchAgent that supervises it. `npm test` proves the reply path
with no external call and no quota spent.

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
