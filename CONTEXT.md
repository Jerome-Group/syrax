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
runtime-specific install, launch and state-placement details, and it is a contract expressed in
configuration rather than a layer of code standing in front of the runtime. Which runtime it wraps
is a settled decision recorded in `docs/adr/`, not an open question. There is no second adapter for
the messaging surface: the runtime brings its own channels, so reaching a new one is a capability
of the runtime rather than a boundary Syrax owns.
_Avoid_: provider, model — and *platform adapter*, which sounds like a sibling of this term but
names a component this system does not build

**Chat**:
One of Syrax's per-domain surfaces, and a *capability boundary* rather than a filing convenience:
which chat a message arrives in determines the tool layer that is reachable, the retrieval scope,
and the session state. A question a chat does not own is redirected to the chat that does, never
answered by reaching across — so the boundary is what keeps each turn's context small. The
boundary is drawn around the **tool layer**, not around the documents: two chats may reach the
same file while only one of them may call the capability that owns it.
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
domain gets. The General chat owns it, and no capability chat performs it. What is indexed is the
index allowlist, so a tree nobody listed is not searchable — but that list is a budget rather than
a fence, and what may never be reached at all is the blocklist. Its reach is over documents alone:
reaching a capability's documents is not reaching that capability's tools, and a chat performing
broad search over them still may not call it.
_Avoid_: global search, full-text search — the first claims the whole machine, which is more than
is ever indexed, and the second names a technique where this names a reach

**Index allowlist**:
The roots that are crawled and indexed, named in advance. It is a **compute scope, not a security
boundary**: it is sized by what is worth indexing on this machine, and a faster machine would
index more. What must never be reached is the blocklist's job, not this list's.
_Avoid_: the allowlist — unqualified, it has meant this, the extraction scope and the blocklist by
turns, which is why all three are named separately here

**Extraction scope**:
The subset of the index allowlist whose documents are opened and read rather than indexed by name
alone. It is **additive**: a path joins it on request, and because nothing in the pipeline is tied
to a particular root, joining is a matter of configuration. A document inside the allowlist but
outside this scope is still findable by name — what is lost is reaching inside it, and a search
says so rather than returning nothing.
_Avoid_: index scope, parse list — the first collides with the allowlist, and the second names a
step where this names a set

**Blocklist**:
What is never indexed, never read, and never extracted, anywhere on the machine — regardless of
which list would otherwise reach it. It is the boundary the index allowlist is not, and it is the
only one that applies outside that allowlist. It fails open where an allowlist fails closed, so it
is revisited when the machine changes rather than settled once.
_Avoid_: denylist, exclusions — the second sounds like a tidying-up of results, where this is the
one list that decides what may be touched at all

**Ephemeral extraction**:
Reading a document that the index does not hold, for one request. It is held only for as long as
the request is live and never written down, so nothing has to decide when deleting it is safe.
_Avoid_: cache, temp file — a cache is kept because keeping it is the point, and a temp file is a
thing on disk, which this is defined not to be

**Lane**:
A named set of models a caller may reach, defined by the **role** it plays rather than by how
strong it is. There are three: the *front* lane, which answers the Owner and owns the message; the
*worker* lane, reached only as a sub-agent and never answering directly; and the *escape hatch*,
rationed and reached only when the Owner asks for it in so many words. A lane is not a fallback
position — front and worker hold their roles at the same time, which is what lets one of them talk
while the other works. Which models sit in a lane, and in what order, is configuration.
_Avoid_: tier — it ranks by strength and implies the members are alternatives, and both readings
are wrong here; model group, which names a mechanism a router happens to offer rather than the
division of labour it is being used for

**Progress message**:
The single message a slow turn keeps up to date: posted at once saying what is about to happen,
edited as the work proceeds, and finally reduced to a line recording that it finished — with the
answer itself arriving beneath it rather than replacing it. It exists because the lane that thinks
is not the lane that talks, so a turn can be slow without being silent, and the thread keeps a
record of what happened rather than overwriting it.
_Avoid_: draft — that names the ephemeral platform mechanism for streaming a *fast* reply, which
this is defined not to be; status update, notification — both are per-event, where this is one
message per turn

**Context ceiling**:
The limit on how much a single turn may carry, with the oldest trimmed away until the turn fits.
It is counted in tokens rather than in turns because one turn can be arbitrarily large, and it
binds per turn rather than per day because a turn re-sends everything it carries on every call it
makes — so what it holds is multiplied, not merely stored.
_Avoid_: context window — that is the model's own maximum, which this sits far below on purpose;
history window, which counts turns where this counts tokens

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
