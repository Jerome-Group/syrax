# Map

Public documentation and implementation of the Owner's personal chatbot system.

Start here: `README.md`, then `AGENTS.md`.

| Area | What lives there | Entry point |
|------|------------------|-------------|
| Working here | Agent + contributor conventions, commit/attribution rules | `AGENTS.md` (= `CLAUDE.md`) |
| Contributing | How work flows here — issue first, then a pull request | `CONTRIBUTING.md` |
| Code standards | How code is written and reviewed | `CODING_STANDARDS.md` |
| Domain language | The glossary — this repository's ubiquitous language | `CONTEXT.md` |
| Decisions | Architecture decision records | `docs/adr/` |
| Research | Findings from research tickets, one cited file per question | `docs/research/` |
| System | Architecture, data flow, and public/private boundary | `docs/system-overview.md` |
| Setup | Safe installation and runtime-injection sequence | `docs/setup.md` |
| Configuration | Public contract and placeholder values | `config/syrax.example.toml` |
| Runtime adapter | Syrax's decisions as one generated runtime configuration | `src/adapter/build.ts` |
| Chat surface | Syrax's own writes into the four chats, and the recreation a failed one triggers | `src/surface/chat-surface.ts` |
| Agent instructions | What each chat's agent is told it is, including how it answers with the corpus | `src/adapter/instruction.ts` |
| Supervision | The two LaunchAgents and the index schedules, and the wrappers' pre-flights that refuse to start wrong | `src/supervision/launch-agent.ts` |
| Search unit | The file-search index and the two tools it serves over MCP — the one part of Syrax that is Python | `search/syrax_search/server.py` |
| Runtime pin | The exact runtime version, installed outside the checkout | `runtime/package.json` |
| Tests | The suite and the two local wires it drives the gateway through | `test/` |
| Agent skills | The routines an agent follows here, one file per skill | `docs/agents/` |
| Automation | The workflows that run on a pull request or on a new issue, and dependency updates | `.github/` |

Update this file in the same pull request whenever a top-level area is added, moved, or removed.
