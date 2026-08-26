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

**Pre-flight**:
What the wrapper does before it hands the process to the runtime: assert the directories the runtime
creates but does not enforce, resolve every credential ref, and say what it found. Its gating is
**asymmetric on purpose** — it refuses to start where the fault would otherwise be a gateway that
comes up and fails every turn, and it warns and proceeds where the fault costs the Owner nothing
today. A check that always refuses is a check somebody removes.
_Avoid_: health check — that runs against a process already up and is somebody else's word for
watching; bootstrap, which is launchd's verb for loading the job and not for anything inside it

**Capture**:
The gateway's second log surface: what the process writes outside the runtime's own log file, which
is the pre-flight's lines and whatever kills it. It is a different file with a different writer and
its own rotation, and keeping the two apart is what lets the lane monitor read the first one keyed
on inode and size.
_Avoid_: stdout, StandardOutPath — launchd's key for this, and launchd is precisely what does not
open it here; log — the unqualified word means the runtime's own file everywhere else in this
repository

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

**Carrier**:
The Telegram mechanism a chat is currently delivered through — a **topic**, addressed by its
`message_thread_id`. All four chats have one, General included. The chat **root** — the thread-less
area whose composer reads *"Off-topic message"* — is deliberately not a carrier: it has no view of
its own, so a chat carried by it could not be scrolled, badged or read apart from every other
chat's messages. What the root is instead is where a message with **no** thread id arrives, and
that is answered as General rather than dropped. A carrier can be cleared, recreated and
re-addressed without the chat changing.
_Avoid_: General topic as a special case — it is an ordinary created topic, and the two attempts
to make it something else (adopting thread id 1, binding it to the root) both failed on
measurement; root as a fourth carrier — it carries nothing and answers what the carriers miss

**Provisioning map**:
Which topic currently carries each chat, kept as private runtime state and keyed by the chat's own
name. It is the only thing that connects a chat to its carrier: **nothing ever matches a chat to a
topic by the topic's name**, because a recreation reuses the name and it is the id that routes. Its
loss is not a failure to detect — there is no read that would find the carriers again, so the write
path recreates what the map does not name, one chat at a time as each is written to.
_Avoid_: topic map — it names the mechanism rather than the chats it is keyed by; registry, which
suggests something a lookup goes through at run time, where this is read when the configuration is
generated and written when a carrier changes

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
alone. An entry is a **root or a pattern**, because one root can hold a faculty's exam papers where
only one department's are wanted — so the scope says which *documents* are read, not only which
trees they sit in. It is **additive**: an entry joins it on request, and because nothing in the
pipeline is tied to a particular root, joining is a matter of configuration. A document inside the
allowlist but outside this scope is still findable by name — what is lost is reaching inside it, and
a search says so rather than returning nothing.
_Avoid_: index scope, parse list — the first collides with the allowlist, and the second names a
step where this names a set

**Blocklist**:
What is never indexed, never read, and never extracted, anywhere on the machine — regardless of
which list would otherwise reach it. It is the boundary the index allowlist is not, and it is the
only one that applies outside that allowlist. It fails open where an allowlist fails closed, so it
is revisited when the machine changes rather than settled once.
_Avoid_: denylist, exclusions — the second sounds like a tidying-up of results, where this is the
one list that decides what may be touched at all

**Shortlist**:
What a close call offers: up to three candidate documents and a way to want none of them, each one
a button the Owner taps. The search unit mints it and is the only thing that can turn a tap back
into a document — a tap carries sixty-four bytes, so what a button holds is a token rather than a
path. It expires, and a tap on one that has is answered *expired* rather than guessed at.
_Avoid_: results, options — the first is the ranked list the verdict exists instead of, and the
second says nothing about there being a way to reject all of them

**Handover**:
A copy of one document placed where the chat can send it from, made by `attach` and swept on the
idle beat. It exists because the runtime uploads a local file only from roots it owns, and the
alternative — widening the agent's own filesystem reach until the corpus is one of them — would
give a model a general file read and cost the blocklist its meaning (ADR-0026).
_Avoid_: upload, staging copy — the first names the step after this one, and the second describes
the mechanism where this names the reason there is one

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
edited as the work proceeds, and **removed once the answer arrives beneath it**. It exists because
the lane that thinks is not the lane that talks, so a turn can be slow without being silent. It is
never edited into the answer, and the thread is left holding the answer rather than a record of the
work — the reduction to a finished line this entry used to claim is not something the pinned runtime
offers, and ADR-0022 is where that was measured.
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
A limit a request fails on for its **size alone** — refused whether or not any allowance remains,
and unchanged by any amount of waiting. It is the counterpart of *headroom*: headroom is what is
left of an allowance and empties and refills, where a wall is met by a single call, which either
clears it or never will. The two earn separate names because a provider need not distinguish them —
one answers both with the same error code and a `retry-after` on each, so a caller that reads the
header alone will keep retrying a call that cannot succeed.

**The size that meets the wall is not the prompt, and it is partly Syrax's own choice.** A request
to Groq is charged its prompt *plus the output it reserves* — whether or not it streams, and whether
or not the reservation is used — so the same conversation clears the wall or is refused by it
depending on a `maxTokens` written in configuration. A wall is therefore a property of the request as
sent rather than of the model as published: it moves when Syrax changes a setting, which makes
clearing it something the configuration owns rather than something the provider fixes. Not streaming
is not such a setting, and ADR-0034 says why the temptation is worth naming.
_Avoid_: rate limit — it names the allowance, which is the thing this is not; context window — a
different ceiling, belonging to what the model can read rather than to what the plan will accept;
per-request ceiling — it names the wall as the model's alone, which is the half this entry corrects

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

**Sweep**:
Asking every chain rung, on a schedule, whether it still answers to its name — one minimal
completion each, spending a real request to observe an absence. It exists because a healthy chain is
*silent*: the runtime logs a decision only once something has already failed, so the rung being
served is the only one a passive read can speak for and the rungs beneath it are invisible until the
day they are needed. It is deliberately **not** a catalogue read: both catalogues have been measured
lying in both directions, so a free `GET` produces false alarms as well as false silence. The
rationed lane is never swept, one probe there being 5% of a rung's day.
_Avoid_: health check — it suggests a free liveness probe, where this spends the same allowance a
turn does; poll, which names the schedule and not the cost; probe — the runtime's own word for a
per-provider credential check, which this is not

**Removal**:
Taking a rotted rung out of its lane for good, on the Owner's tap and on nothing else. It is the
opposite of a *stand down* in the way a *rotted rung* is: a stand down is written back at its reset,
where a removal has no reset to return at, so nothing schedules its return and nothing is owed one.
Syrax is the actuator and the Owner is the decision — a 404 cannot be told apart from a transient
unrouting, and neither can it be *repaired*, since choosing a replacement needs a catalogue already
measured wrong. The report carries the button so that acting costs a tap rather than a JSON editor.
_Avoid_: replacement — the thing Syrax refuses to do, and naming this that hides the refusal;
stand down — bounded by a reset this has none of; disable, which reads as a setting that can be
unset rather than a rung written out of a chain

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
posted only when a number moved or a run failed, and written to a file either way. It arrives
without being asked for, and one scoring run is delivered once however often the beat that carries
it fires — the search unit scores the set on its re-embed pass and writes the numbers down, and the
lane monitor, which is where the bot token is, posts what that pass wrote. Its subject is
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
already is. Only the academic chat has one at v1, where the *academic desk* composes it from what
the overnight jobs left behind and posts it — never a model's turn, since a heartbeat that depends
on a free tier stops when the free tier does.
_Avoid_: digest, notification, alert — a digest may be skipped on an empty day, which is the thing
this is defined not to do, and the other two are per-event where this is per-day

**Academic desk**:
The resident unit that holds the academic pair as Syrax reaches it: the tools the academic chat
calls, and the *daily brief* it posts each morning. It is named for the counter rather than for
either job because it is neither — it is the one place *refresh-then-read* happens, and both the
tools and the brief follow from that. Like the *lane monitor* it is a unit of Syrax's rather than a
capability's own product, and for the opposite reason: the monitor holds state no product has, and
this holds none at all — it asks, reads, and forgets.
_Avoid_: academic agent — that is the chat's agent, which is the runtime's; academic service, which
suggests something the products call rather than something that calls them

**Refresh-then-read**:
How Syrax reaches every capability whose product owns its own credentials: trigger the product's own
refresh, then read the output that refresh wrote. It is a boundary rather than a technique — Syrax
holds no credential of the product's and builds no capability functionality — and it is what makes a
capability's own tool layer the authority on its domain. A *confirmed write* attaches to consequence
and never to the word: a pull-only refresh that caches is a read, and only a write to something the
Owner would notice waits for a tap.
_Avoid_: sync, polling — the first names one product's own command and the second a schedule, where
this is about who holds what

Two terms are Organisation-wide and mean the same thing in every repository:

**Organisation**:
The `Jerome-Group` GitHub org — the top-level account that owns the repositories.
_Avoid_: team, group

**Baseline**:
The configuration every repository in the Organisation inherits — branch protection, the
security defaults, and the per-repository settings. It is applied from the management hub, not
from here.
_Avoid_: template, policy, default

**Spent-claim mark**:
The italic parenthetical an ADR body carries on a claim a later record has spent, naming that
record and linking to it — plus a `~~strikethrough~~` where the claim was wrong rather than merely
overtaken. It sits immediately after the claim, names exactly one record, and adds no argument;
ADR-0018 bounds it. Distinct from a **credential marker**, which is a placeholder in tracked
configuration and has nothing to do with records.
_Avoid_: marker, annotation, note
