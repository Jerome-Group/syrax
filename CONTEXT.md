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

**Chat**:
One of Syrax's per-domain surfaces, and a *capability boundary* rather than a filing convenience:
which chat a message arrives in determines the tool layer that is reachable, the retrieval scope,
and the session state. A question a chat does not own is redirected to the chat that does, never
answered by reaching across — so the boundary is what keeps each turn's context small.
_Avoid_: topic, thread — both name the Telegram mechanism that currently carries a chat rather
than the boundary it draws, and that mechanism has a documented fallback that would strand the
word

**Public configuration**:
A tracked example or interface contract containing placeholders and no live secrets or private
state.
_Avoid_: local config, deployment secret

**Private runtime state**:
Credentials, sessions, chats, memory, provider responses, caches, logs, and machine-specific
paths produced or consumed while Syrax runs. It stays outside the repository.
_Avoid_: source, fixture

**Scoped search**:
Retrieval bounded to one capability's corpus, such as the academic chat reaching only what sits
under the modules root. It is not a second search: it is the *same* retrieval with a restriction,
and the restriction is what makes it fast enough to answer in a chat.
_Avoid_: local search, filtered search — the first suggests an index of its own, and the second
says nothing about what does the bounding

**Broad search**:
Retrieval across everything indexed, bounded by no capability. What a question that names no
domain gets. The General chat owns it, and no capability chat performs it.
_Avoid_: global search, full-text search — the first claims the whole machine, which is more than
is ever indexed, and the second names a technique where this names a reach

**Daily brief**:
The message a chat posts each morning without being asked: the day ahead, what arrived overnight,
and how the overnight jobs went. It is posted whether or not anything happened, and it mentions
everything new without detailing any of it. **One per chat, not one per system**: it is posted in
the chat whose corpus it draws on, so the follow-up question lands where the context to answer it
already is. Only the academic chat has one at v1.
_Avoid_: digest, notification, alert — a digest may be skipped on an empty day, which is the thing
this is defined not to do, and the other two are per-event where this is per-day

Two terms are Organisation-wide and mean the same thing in every repository:

**Organisation**:
The `Jerome-Group` GitHub org — the top-level account that owns the repositories.
_Avoid_: team, group

**Baseline**:
The configuration every repository in the Organisation inherits — branch protection, the
security defaults, and the per-repository settings. It is applied from the management hub, not
from here.
_Avoid_: template, policy, default
