# Syrax — context

The domain is a personal chatbot system: a user-facing interface, an agent runtime, tools, model
providers, context, memory, and the private state that connects them.

## Language

The ubiquitous language of this repository: the words the code, the issues and the commits all
use for the same thing. An entry earns its place when two people — or a person and an agent —
could reasonably mean different things by the same word.

Each entry is the term, what it means **here**, and the near-synonyms to avoid so the wrong one
does not creep back in.

**Syrax**:
The public system described and implemented by this repository, including its setup contract and
future runtime adapters.
_Avoid_: chatbot app, prompt collection

**Runtime adapter**:
The boundary that connects Syrax's orchestration contract to one concrete agent runtime. It owns
runtime-specific install and launch details; the choice is not settled yet.
_Avoid_: provider, model

**Public configuration**:
A tracked example or interface contract containing placeholders and no live secrets or private
state.
_Avoid_: local config, deployment secret

**Private runtime state**:
Credentials, sessions, chats, memory, provider responses, caches, logs, and machine-specific
paths produced or consumed while Syrax runs. It stays outside the repository.
_Avoid_: source, fixture

Two terms are Organisation-wide and mean the same thing in every repository:

**Organisation**:
The `Jerome-Group` GitHub org — the top-level account that owns the repositories.
_Avoid_: team, group

**Baseline**:
The configuration every repository in the Organisation inherits — branch protection, the
security defaults, and the per-repository settings. It is applied from the management hub, not
from here.
_Avoid_: template, policy, default
