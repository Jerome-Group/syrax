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

**Skill**:
An instruction sheet the agent runtime can read: a name, a description, and a body telling the
agent how to go about something. It is **not a capability** — a skill grants no reach of its own,
and everything it describes doing is done through the tool layer, which is where the boundary
actually sits. What it costs in context is its index card rather than its body: name and
description are injected on every turn, and the body is read only where the skill is used. Which
skills an agent carries is configuration and is resolved per agent, so a skill can be paid for in
one chat alone. Syrax carries none at v1 — the runtime's own bundled catalogue is switched off
alongside the third-party one, because a description of a capability the tool layer does not grant
is a cost with nothing on the other side of it.
_Avoid_: tool — the thing a skill tells the agent how to use, and the thing that actually grants
the reach, so folding the two together hides where the capability boundary is; plugin, extension —
both name something that adds a capability, which is what this is defined not to do

**Gateway**:
The agent runtime's own long-lived process: the one that holds the sessions and carries every chat.
The word is upstream's and is reserved for it, because the provider side of this system is *the
router* and the two were briefly sharing a name. Two long-lived processes under one word is how a
sentence about restarting "the gateway" comes to mean two different things to two readers.
_Avoid_: router — that is the provider side, and keeping the two apart is the whole reason this
entry exists; proxy — which names something standing *between* two parties, where this is one of
the parties

**Router**:
How a lane's chain is walked and when a provider is stood down. It is a **behaviour, not a
component**: no process in this system is the router. The runtime walks the chains it is configured
with, and the little Syrax adds sits beside that rather than in front of it. The word survives
because the behaviour still needs a name and because *gateway* had been carrying it.
_Avoid_: gateway — the runtime's own process, and the collision that made both of these entries
necessary; proxy, provider router — both name a thing on the request path, and the point of this
entry is that there is no such thing here

**Chat**:
One of Syrax's per-domain surfaces, and a *capability boundary* rather than a filing convenience:
which chat a message arrives in determines the tool layer that is reachable, the retrieval scope,
and the session state. A question a chat does not own is redirected to the chat that does, never
answered by reaching across — so the boundary is what keeps each turn's context small. The
boundary is drawn around the **tool layer**, not around the documents: two chats may reach the
same file while only one of them may call the capability that owns it. **A chat's existence is
Syrax's, not the Owner's furniture**: the set of chats is the system's shape, so clearing away the
Telegram topic that carries one is a view operation rather than a decommission. A chat ends when
Syrax stops being configured for it, and never because its carrier was cleared.
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

**Secrets store**:
The single file every Syrax credential lives in, and the only place any of them is ever written.
The runtime reads it directly rather than being handed its contents through the environment, so a
credential is never a variable a child process could inherit and never a second copy left to go
stale where nothing thinks to look for it. Its protection is the file's own mode, and a store the
machine has left readable is **refused rather than used** — which is the property that makes one
file safer than one file plus whatever the runtime decided to persist beside it.
_Avoid_: env file — the shape this had while a wrapper was passing credentials through the
environment, and a name that suggests the process is handed them; vault, secret manager — both name
a service standing somewhere else, where this is a file on the same disk as the things it protects

**Credential marker**:
The non-secret placeholder written where a resolved credential would otherwise have been persisted.
It exists to make an absence *legible*: a generated file that simply omitted the field would read
the same as one nobody had configured. Whether a marker can be recognised as one is a property of
the marker and not of the reader — a marker that names an environment variable is only understood
where that name is already known, so the form worth using is the one that names nothing.
_Avoid_: placeholder — this repository already uses that word for the public-configuration sense,
where a human is expected to substitute a real value; redaction, which names something done to a
secret that was there, where this stands in a place one never was

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

**Miss**:
A search result the Owner has said was wrong. It is one word for five different failures — a
confident answer that was wrong, a shortlist without the answer in it, a shortlist that buried it,
an *empty* verdict over a corpus that held the answer, and the right document at the wrong
granularity — so each one records which of them it was, because they are fixed in different places:
a threshold for some, the ranking or the chunking for others. A miss exists only where the Owner
said so, in reply to the result itself; nothing infers one from how the next message reads.
_Avoid_: false positive, bad result — the first names one of the five and silently excludes the
other four, and the second says nothing about who decided; feedback, which suggests something the
system acts on where this is something it records

**Retrieval benchmark**:
The one set of queries the search index is scored against: the fixed ones written by hand and the
misses captured from live use, in a single file where each entry carries which of the two it is. One
set rather than two, because two would leave a standing question about which of them is the bar. It
lives outside the repository with the rest of private runtime state, since every entry is a real
query against a real private path — so nothing running off this machine can score it.
_Avoid_: fixture — what it was while it was only the hand-written half, and a word that stops being
true the moment a live entry lands; test suite, which promises a pass or a fail where this yields a
score

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

**Rung**:
One position in a lane's ordered chain: a single model at a single provider, tried in turn until one
answers. It is the unit almost everything else here is counted against — *headroom* is read per
rung, a *wall* is a property of one, a *stand down* removes one — so the word carries weight it is
rarely given. Two rungs may name the same provider and differ only by model, and that is not
redundancy: a provider's limits and its outages are per model, so one model of a provider can be
refusing while another on the same key answers everything. A rung is named in configuration and
nowhere else, which is what makes its contents a matter of judgement rather than of code.
_Avoid_: fallback — it names the *move* to the next rung rather than the position itself, and using
it for both hides which is meant; model, which omits the provider that half of a rung's behaviour
belongs to; tier — ruled out at *lane* for the same reason, and worse here, since rungs are ordered
by suitability rather than by strength

**Slow turn**:
A turn in which the front lane delegates to the worker lane. It is defined by **delegation rather
than by elapsed time**: nothing in this system sits on the request path to hold a stopwatch, and
the front agent knows it is about to delegate at the moment it decides to. So a turn that merely
takes a while — several retrieval calls, or a degraded rung answering slowly — is not one of these
and shows a typing indicator like any other. This is the whole of the distinction, because it is
what decides whether the Owner gets a *progress message* or nothing.
_Avoid_: long turn, slow reply — both name elapsed time, which is the reading this entry exists to
rule out; background task, which suggests something the Owner is no longer waiting on

**Progress message**:
The single message a slow turn keeps up to date: posted at once saying what is about to happen,
edited as the work proceeds, and finally reduced to a line recording that it finished — with the
answer itself arriving beneath it rather than replacing it. It exists because the lane that thinks
is not the lane that talks, so a turn can be slow without being silent, and the thread keeps a
record of what happened rather than overwriting it.
_Avoid_: typing indicator — the other thing the front lane can show, and the one this is paired
against: an indicator says only that *something* is happening where this says *what*, and a turn
shows one or the other rather than both; status update, notification — both are per-event, where
this is one message per turn

**Headroom**:
How much of a lane's capacity remains right now, as last stated by the provider itself rather than
as counted here. It is per lane rather than per model because a lane is a role: the question behind
it is whether the system can still talk and still think. Where a provider reports nothing, headroom
is *unknown* rather than full — so what is given is the last thing that provider said, and when it
said it.
_Avoid_: quota — that is the provider's allowance, where this is what is left of it; budget — a
self-imposed allowance, which this system deliberately does not have

**Wall**:
A limit a request fails on for its **size alone** — a model's per-request token ceiling, which
refuses the call whether or not any allowance remains, and which no amount of waiting changes. It is
the counterpart of *headroom*: headroom is what is left of an allowance and empties and refills,
where a wall is a fixed property of the model, and a request either clears it or never will. The two
earn separate names because a provider need not distinguish them — one answers both with the same
error code and a `retry-after` on each, so a caller that reads the header alone will keep retrying a
call that cannot succeed. Whether a lane's rungs clear that lane's largest call is therefore settled
in configuration, before anything is sent.
_Avoid_: rate limit — it names the allowance, which is the thing this is not; context window — a
different ceiling, belonging to what the model can read rather than to what the plan will accept

**Stand down**:
Removing a provider from a lane until a stated reset, as against retrying it in a moment. The
distinction is the whole of quota awareness and the transport hides it: a per-minute limit and an
exhausted day are both HTTP 429, and only the response body or a locally-kept count says which. A
stood-down provider is not broken — nothing ails it that the reset will not cure — but it **is
reconfigured, and it does not come back by itself**. A lane's membership is configuration, so the
rung returns only when something writes it back at the reset it was stood down until: the return is
owned rather than awaited, and a stand down with no return scheduled is a rung retired by accident.
_Avoid_: cooldown — it lapses on its own after seconds, where this lasts until a stated reset and
lapses only when something acts; disable, which sounds permanent where this is bounded by the reset
that ends it; pin — the apparent opposite and not one, since a pin forces a *selection* within a
lane and belongs to the runtime, where this changes a lane's *membership* and belongs here

**Rotted rung**:
A rung whose model no longer answers to the name its chain calls it by — archived, retired, renamed,
or moved off the free plan. It is the opposite of a *stand down* rather than a kind of one: a stand
down is bounded by the reset it ends at, where nothing a rotted rung waits for ever arrives, so it
returns only when a person writes the chain. Nor is it *headroom*, having no allowance left to
measure, nor a *wall*, which is a living model refusing a request for its size. What makes it worth a
word is that it is **silent**: the chain simply advances, every turn pays for the dead rung again,
and the lane goes on working until it runs out of rungs. It is discovered by being reported, not by
being noticed.
_Avoid_: stand down — the entry above, bounded by a reset this has none of, and the confusion that
would file a permanent loss as a temporary one; outage, which is the provider being down rather than
the model being gone; deprecated — the provider's word for an announcement, where this is the state
after the model has already stopped answering

**Pre-emptive switch**:
Leaving a provider *before* it refuses, on what its telemetry already says rather than on a failure
that has happened. It is reserved for where being refused is expensive, and expense is measured
against a **daily** allowance — the rationed lane, where a single probe spends a measurable share of
the day, and any rung whose binding limit is tokens-per-day rather than requests. It is always a
*stand down* written into configuration, off the request path, and **never a filter that weighs a
request on its way out**: a request no rung can accept has met a *wall*, and a wall is settled by
which rungs are in the lane rather than by anything decided per call. Where the allowance is large
enough that a refusal costs one call, the system waits to be refused instead, and that is a choice
rather than an omission.
_Avoid_: fallback, failover — both name the move made *after* something failed, which is a
different move and the more common one here; using them interchangeably hides which of the two a
lane actually does; throttling, which slows a caller down where this moves it

**Lane monitor**:
The one thing that holds what Syrax knows about its own lanes and the runtime does not: the rationed
lane's counters, which rungs have *rotted*, and when each source it reads was last read. It writes
the *usage report* and it serves the escape hatch, but neither is what it is — both are things that
follow from being the only place lane state is kept, which is why it is named for the state rather
than for either job. It observes and refuses; it never chooses a model, and it sits on no path a
reply travels.
_Avoid_: router — fixed elsewhere on a behaviour, and on the explicit finding that no such process
exists here; gateway, which is the runtime's own process; escape-hatch unit, the name it had while
the hatch was the only thing it did — accurate then and now the smallest of three, so a reader
looking for what watches the front lane would not think to open it

**Usage report**:
What the System chat says about the state of each lane: how much of it is left, and whether its
rungs are still there. The second subject is not the first — a *rotted rung* has no allowance to be
low on — and they share a report because they answer one question between them, whether the lane can
still be relied on. It is posted **only when something
moved** — a provider stood down, a lane switched, a rationed call spent, a rung found rotted or
found working again — and is otherwise silent,
which is exactly what separates it from a *daily brief*: a brief is posted on an empty day because
its absence is the signal, and nothing depends on this one arriving. It can be asked for at any
time instead, which is why the chat that carries it is conversational rather than a feed.
_Avoid_: daily brief — the shape it is most likely to be mistaken for and deliberately is not;
dashboard, which suggests a surface that is always on display

**Retrieval report**:
What the System chat says about how the search index is scoring against the retrieval benchmark:
posted only when a number moved or a run failed, and written to a file either way. Its subject is
retrieval quality where the *usage report*'s is lane headroom — the two arrive in the same chat
under the same exceptions-only discipline, which is the whole reason both are named here. It states
what the confident floor would be if it were re-fitted against the benchmark as it now stands, and
never applies it: computing a number is reporting, and changing the configuration is a person's act.
_Avoid_: usage report — the sibling it arrives beside and the one it is most likely to be folded
into; eval, benchmark run — the first names a discipline and the second an event, where this is the
thing that gets read

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
