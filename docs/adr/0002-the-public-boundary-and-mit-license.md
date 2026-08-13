# The public boundary and MIT license are part of Syrax's contract

Syrax is public and MIT licensed from its first project commit. The repository publishes the
Owner's chatbot system: its architecture, setup contract, safe examples, and future runtime
adapters. It does not publish the conversations or accounts the system operates on.

## What the repository grants

MIT grants reuse, modification, and distribution of the code and documentation owned by this
project. A public repository without a license permits inspection but not the adoption this system
is intended to support. Dependencies, models, runtimes, prompts, and external services keep their
own licenses; this file does not relicense them.

## What the repository keeps out

The public tree may contain source, architecture, setup instructions, placeholders, and synthetic
fixtures. It excludes API keys, OAuth or browser sessions, private chats, private memory, provider
responses, machine-specific paths, runtime caches, and logs containing those values. Secrets enter
at runtime through the environment or a private secret store. Runtime roots live outside the
checkout, and the ignore rules provide a second line of defence.

This boundary is drawn before the first private runtime commit. Opening the repository later would
turn one decision about a new tree into an audit of every earlier commit, which is the failure mode
the public-from-creation decision is meant to avoid.

## Why the runtime is not named here

The repository is meant to explain the system independently of one vendor or runtime. OpenClaw and
Hermes are candidates for evaluation, not selected dependencies. When an adapter is chosen, its
installation, permissions, license compatibility, and state placement become a new project-level
decision in the ADR directory.

## Consequences

- Every tracked example must be safe to publish and must label placeholders as examples.
- A runtime adapter must inject secrets and write state outside the repository.
- The project can be copied and adapted under MIT, while third-party terms remain in force.
- The initial repository is useful as a design and setup reference before executable runtime code
  exists.

## Revisit when

- A concrete runtime or model dependency is selected or replaced.
- A contributor needs a different license or the project incorporates material incompatible with MIT.
- Any private conversation, memory, session, credential, provider response, or local state is
  proposed for tracking.
