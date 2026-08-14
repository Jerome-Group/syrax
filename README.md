# Syrax

Syrax is the public, MIT-licensed reference repository for my personal chatbot system: how its
pieces fit together, how it is set up, and which runtime boundaries keep private state private.
It is intended for people who want to understand, run, or adapt the system.

A [Jerome-Group](https://github.com/Jerome-Group) repository. Start with [`MAP.md`](MAP.md) for
the layout and [`AGENTS.md`](AGENTS.md) for the working rules.

## Status

🌱 **Public design baseline.** The repository currently documents the system and its safe setup
contract. The concrete agent runtime is not selected yet; OpenClaw and Hermes are candidates for
evaluation, not decisions recorded here. Runtime code and exact launch commands will arrive with a
separate project decision.

## What is here

- [`docs/system-overview.md`](docs/system-overview.md) — the components, data flow, and public/private boundary.
- [`docs/setup.md`](docs/setup.md) — the safe setup sequence and the checks before a runtime is launched.
- [`docs/configuration.md`](docs/configuration.md) — the configuration contract and placeholder example.
- [`config/syrax.example.toml`](config/syrax.example.toml) — illustrative public configuration, not a live file.
- [`docs/adr/`](docs/adr/) — decisions that cannot be recovered from the future code alone.

## Getting started

There is no runnable chatbot command in this baseline because selecting the runtime is still an
open project decision. Read the overview and setup guide first. When a runtime adapter is added,
its install, run, test, and secret-injection commands belong in [`docs/setup.md`](docs/setup.md)
and in the adapter's own code.

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
