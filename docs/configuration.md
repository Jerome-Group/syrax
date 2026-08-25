# Configuration

[The example configuration](../config/syrax.example.toml) is a public interface sketch. It names
the decisions a deployment must make without pretending that the current repository already parses
the file. A runtime adapter may translate this contract into its own configuration, but it must
keep the boundary intact.

## The deployment file and what is generated from it

Two files, and only the second is the runtime's. A **deployment** describes one machine — the roots
the runtime must be told about rather than left to choose, the single Telegram account that is
answered, the provisioning map that records which topic carries which chat, and the two base URLs;
[`config/deployment.example.json`](../config/deployment.example.json) is its public shape.
`src/cli/generate-config.ts` reads it and writes the runtime's own configuration, which is where
every decision this repository's records argue actually lands.

Neither live file is tracked. The deployment names machine-local paths and the Owner's Telegram ID;
the generated configuration carries both plus the shape of the secrets store. What is tracked is
the generator and the tests that hold it to the records — a decision asserted in a test is one a
later edit cannot quietly inherit away.
[ADR-0019](adr/0019-the-configuration-contract-is-generated-and-the-generator-runs-before-the-gateway.md)
argues why generating it is not the code layer ADR-0003 forswore.

Regenerating is the deployment path. A decision changes in `src/adapter/`, the generator runs, the
gateway restarts; there is no partial edit of a live configuration.

| Section | Meaning | Public value |
|---------|---------|--------------|
| runtime | The selected adapter and executable entrypoint | Placeholder until a runtime is chosen |
| model | Provider and model selection | Names only; credentials stay outside the file |
| paths | Roots for private state, chat archives, the search index, its benchmark, the logs and the lane monitor's own state | Absolute paths outside this repository |
| security | Secret source and tool policy | Environment/private store plus explicit allowlist |
| observability | Log and trace handling | Sanitised local output by default |

## Local configuration

Use a filename matching config/*.local.* or config/*.secret.*; those patterns are ignored. A local
file is still not automatically safe: keep its parent directory private, inspect the diff before
every commit, and prefer environment variables or a dedicated secret store for credentials.

## State placement

The runtime state path must not be a child of this repository. This includes chat history, memory,
browser sessions, caches, databases, logs, and provider responses. A path outside the checkout
means a broad git add cannot accidentally turn a live session into a public commit.

The **search index** belongs to the same category and is the largest member of it: it holds the
extracted text of private documents verbatim, in a full-text table, and is measured in hundreds of
megabytes. An ignore rule is not the control here — it stops an accidental `git add` and nothing
else, and this repository states its rule as placement. Give it its own path beside the runtime's
state directory rather than inside it, so that re-pinning or resetting the runtime does not discard
an index that costs hours of embedding to rebuild. [ADR-0004](adr/0004-syrax-owns-the-file-search-index.md)
carries the reasoning.

## The units

Syrax is supervised as launchd LaunchAgents rather than one process or a container.
[ADR-0005](adr/0005-launchd-supervises-syrax-as-two-launchagents.md) carries the reasoning; what
matters for configuring a deployment is that they are separate on purpose, and the rule behind the
split is **one unit per resident thing that must exist exactly once**.

| Unit | What it runs | Why it is its own unit |
|------|--------------|------------------------|
| `com.jerome-group.syrax.gateway` | The agent runtime | It holds the sessions and carries every chat |
| `com.jerome-group.syrax.search` | The resident search service | One embedder in memory regardless of how many agents connect |
| `com.jerome-group.syrax.hatch` | The **lane monitor**: the escape-hatch tool, the usage report, the rung watch, the daily sweep and the retrieval report's delivery | Its counters must be single-instance and must survive a restart of anything else |
| `com.jerome-group.syrax.academic` | The **academic desk**: the academic pair's tools, and the morning brief | It listens for the brief's poke and writes into the chat after the turn that asked is over |

The second is the one that is easy to get wrong. The usual MCP transport has each client spawn the
server as a child process, which would put one resident embedding model behind **every** agent. The
search service is therefore standalone and bound to loopback, and the agents connect to it — so the
model is loaded once and survives a gateway restart.

The third is separate for the same rule and the opposite reason: it is almost weightless, but its
counters track a rationed daily allowance, and folding it into the search service would mean an
embedder restart silently handing back an allowance that has already been spent.
[ADR-0006](adr/0006-the-runtime-routes-and-syrax-owns-the-escape-hatch.md) carries that reasoning,
and the decision it rests on — that there is **no provider-router process**, because the runtime's
own fallback chains do the routing.

It is called the **lane monitor** because the hatch is now the smallest of three things it does. It
also reads the gateway log for rungs the chains have dropped, and sweeps the rungs the log cannot
see, per [ADR-0012](adr/0012-a-rotted-rung-is-reported-and-never-repaired.md). The launchd label
stays `com.jerome-group.syrax.hatch`; the name is vocabulary rather than a redeploy.

Its own three keys sit in the deployment beside the search unit's, and it is installed the same way:

| Key | What it is |
|-----|------------|
| `monitorState` | Where the rationed lane's counters, the stand-down ledger, the usage report and the stamp of the last retrieval report delivered live — private runtime state, outside the checkout, and the reason the unit is separate: a restart that lost the counters would hand back an allowance already spent |
| `monitorWrapperPath` | Its wrapper, in the gateway's shape. What the wrapper runs is **this repository's own source**, since the monitor is Syrax's code where the other two units are installed trees |
| `monitorPort` | The loopback port the agents reach the escape hatch on; `18791` unless the deployment says otherwise |

```
node src/cli/install-monitor-agent.ts <deployment.json>
```

Its pre-flight has this unit's own two checks. It **refuses to start** when the counters' directory
cannot be made private, and when the secrets store is missing or the machine has left it readable —
[ADR-0010](adr/0010-one-secrets-store-reached-by-file-backed-refs.md)'s refusal met once at start
rather than at each call the hatch makes.

## The academic desk

The Academic chat's tool layer is a unit of Syrax's because neither academic product has one to
lend: both expose a CLI with a versioned `--json` report, and turning one of those into a tool is
what **refresh-then-read** is —
[ADR-0030](adr/0030-the-academic-desk-composes-the-brief-and-the-writes-wait-for-a-tap.md) carries
the reasoning. Syrax triggers each product's own refresh and reads what it wrote; it holds no Google
and no NTULearn credential, and every command it runs names that product's own configuration.

Its keys sit in the deployment beside the other units', and it is installed the same way:

| Key | What it is |
|-----|------------|
| `academicWrapperPath` | Its wrapper, in the gateway's shape. What the wrapper runs is **this repository's own source**, as the lane monitor's does |
| `academicPort` | The loopback port the Academic agent reaches the desk on and launchd pokes the brief on; `18792` unless the deployment says otherwise |
| `academicOsRoot` | The `academic-os` checkout. Its CLI is `dist/src/cli.js`, which means the Owner has run `npm ci && npm run build` there |
| `academicOsConfig` | That product's own gitignored local configuration — where **its** credentials are named, and never read here |
| `academicOsState` | That product's private `stateRoot`: the calendar mirrors a Refresh writes live under it, and reading them is the *read* half |
| `ntulearnRoot` | The `ntulearn` checkout, whose CLI is `src/cli.mjs` |
| `ntulearnState` | Its state directory — the parent of its configured `statePath` — holding the `latest.json` its watchdog writes |
| `academicState` | The desk's own private scratch, holding one thing: the Proposal input it writes for `academic-os` to read back |

All six product paths are named together or not at all: half a pair is a machine configured while
somebody was interrupted. A deployment naming none of them **cannot be generated at all** — the
Academic chat would carry seven tools with nothing behind them.

```
node src/cli/install-academic-agent.ts <deployment.json>
```

Its pre-flight refuses to start on a scratch it cannot make private and on a secrets store the
machine has left readable — it reads the bot token to post the brief. It **warns and proceeds** on a
product whose entrypoint is not there, which is the one place this unit's asymmetry differs from the
others': refusing would turn an unbuilt checkout into a silent morning, and the brief is the daily
heartbeat.

### What it answers, and what it writes

| Question | Where the answer comes from |
|---|---|
| What's due | The calendar Refresh, then the **Academic and Commitments** mirrors it wrote. Routine is never read — it is sleep, meals and exercise |
| Did the sync run | `latest.json`'s verdict, `green`, `yellow` or `red`, as its watchdog wrote it |
| Anything new | The announcements a sync already wrote under the modules root |
| Is the folder conforming | `audit --json`, on demand only: nothing schedules an audit, so there is never a fresh observation to volunteer drift from |
| Content questions | Scoped search, bounded to the modules root by `searchScopes.academic` — the same root the announcements are read under |

Two operations write, and each stands behind an **in-chat confirmation**: `ntulearn sync`, which
spends the saved SSO session and puts files on disk, and calendar **Promotion**. The desk mints a
value, the Owner taps the button carrying it, and the write happens on that value and on no other
input — the same shape as a rotted rung's removal tap. A tap is spent when it resolves and forgotten
when the unit restarts, so a second tap and an old one both answer *expired*.

A calendar **Refresh** and a **Proposal** are not confirmed: the first is pull-only and never
touches Live, the second is private and trivially discarded. Confirmation attaches to consequence
rather than to the word *refresh*. And some things have no tool at all and are not going to get one
— `ntulearn login`, `renumber`, `seed`, `repair` — so the chat says what is needed and stops.

### The morning brief

At 07:00 launchd pokes `/brief` and the desk composes one, from the day ahead, what arrived
overnight, and how the overnight jobs went — in that order, because the day ahead is the part with a
decision attached. It is posted **whether or not anything happened**: its absence is the signal, and
a morning with no brief means Syrax is down. A `yellow` or `red` sync verdict carries the one line
only the Owner can act on, which is that the saved NTULearn session needs re-opening.

It is composed here rather than asked of a model for the same reason: a brief that is a free-tier
turn is a heartbeat that stops when a provider does, and the day ahead is exactly the list of times
and titles the front lane is told never to state without a tool.

The calendar mirror keeps recurring masters compact, so the desk expands `FREQ=DAILY` and
`FREQ=WEEKLY` rules — `INTERVAL`, `BYDAY`, `COUNT` and `UNTIL` — and returns anything else as
`unexpanded` with the rule itself. A morning it cannot see fully never reads as a morning with
nothing in it.

## The escape hatch

The rationed lane is reached through one MCP tool the monitor serves, `syrax-monitor__reach`, and
every chat carries the connection: the hatch is a **lane** rather than a capability, so a chat
boundary is the wrong thing to draw around it — the Owner asking for it in Academic is asking about
the question in front of them.

Every chat's standing instruction says what opens it — the Owner's own words and nothing else — that
a refusal is relayed rather than retried, and that an answer states what is left. Where the hatch
refused and the lane answered the question itself, the reply says whose answer it is.

What the tool does that a chain rung cannot is **refuse before it spends**. It refuses a call the
Owner did not ask for in so many words, and it refuses a day whose rungs are gone; in both cases
nothing leaves the machine. Every answer states what is left, so *"two hatch calls left today, still
want it?"* is a thing the front lane can say.

The counters are per rung, one per model row of the version ladder, each carrying that row's own
20-a-day allowance. A call is counted **before the request leaves**, so a crash between the call and
the answer cannot hand an allowance back — and it is **put back where the provider never served
it**: a 5xx, a transport failure and a timeout are refunded, where a 429 and any other 4xx are the
provider's own answer about the request and stay spent. What refused a rung is kept beside the
counts in the provider's own words, and outlives the day the counts are emptied on. The day rolls
where the provider resets it rather than where the machine is.
Which rows the lane holds is `src/adapter/hatch-lane.ts`, and it is **four** — measured on the
account rather than read off the catalogue, which lists seven Flash rows of which one is an alias of
the newest and one is withdrawn while still listed. A row joins the lane only once it has answered
and its neighbours have been probed in the same minute, because a name is not an allowance;
[ADR-0029](adr/0029-the-rationed-lanes-rungs-are-measured-and-there-are-four.md) carries the
measurement and the rule.

**Headroom is read per provider, and the timestamp is part of the reading.** The provider is the
authority wherever it speaks: Mistral and Groq state their remaining rungs in headers on a call
already being made, and those numbers are taken over any count kept here. Gemini reports nothing at
all, which is why it is the one provider counted locally. Z.AI publishes no allowance to count and
reports none, so its headroom is *unknown* — as is a source whose telemetry has stopped parsing,
which then says when it was last understood rather than reading as a quiet day.

## The usage report

The lane monitor writes the usage report to `usage-report.json` under its own state root, beside the
counters it is drawn from. It is written to a file as well as posted in chat because an agent working
in the checkout cannot read the chat surface, and the counters it draws on are private runtime state
that is never committed. Every build of the report writes the file, whether or not anybody is told.

**It is asked for at any time and arrives unasked only on a transition.** The System chat calls
`syrax-monitor__report` — the tool is System's alone, where the hatch is every chat's — and the same
report is posted into System when something moved: a rung stood down or returned, a lane switched, a
rationed call was spent, a rung found rotted or found working again. Nothing else posts it. A message
that says the same thing every time trains the Owner to ignore it, and this is the one they must not.

It carries per-lane headroom — the rung that answers next and what that provider has left — with
each provider's own telemetry beneath it, and **it states when it last successfully read each
source**. The rationed lane is the counted one, because its provider reports nothing; the two chain
lanes are stated from what their own providers said, and never from the rationed lane's counts,
which are an allowance the front lane does not draw on. That timestamp is not decoration: most of the telemetry is
read out of the runtime's own internal state, so a change there would otherwise break the report
silently — and a stale report is indistinguishable from a quiet day.

It also reports **rotted rungs** — chain members whose model no longer answers to the name the chain
calls it by. That is a different subject from headroom, a vanished model having no allowance left to
measure, and it arrives in the same report because the two answer one question between them: whether
the lane can still be relied on. A rung is reported when it changes state and listed in between, with
the provider's own message passed through verbatim, and every post carries a **removal button** per
rotted rung. Nothing is ever replaced automatically, and nothing is removed except on the tap. [ADR-0012](adr/0012-a-rotted-rung-is-reported-and-never-repaired.md) carries the
reasoning.

For this the unit reads the gateway's own log, where the runtime already classifies a
`model_not_found` and names the rung that answered instead. It keeps a byte offset keyed on inode, size **and** a print of the
bytes the last read left behind — a filesystem is free to hand a replacement file the deleted one's
inode, and a log that has only just started again is not shorter than a small offset into the old
one — and it reports **the window it actually covered** rather than only when it last ran — a log
it cannot open, a log replaced under it, or a gap it can prove it missed is *unknown* rather than a
quiet day. launchd pokes `POST /watch` on the loopback port hourly, at 47 minutes past, and the same
read is what notices a **lane switch**: the lane answering on a rung below the one it was last seen
on.

The log speaks only once something has already gone wrong, so a rung *beneath* the serving one is
invisible until the one above it fails. Those are covered by the **daily sweep**: one minimal
completion through each chain rung, poked at `POST /sweep` at 06:07, which is seven real requests a
day spent to observe an absence. A catalogue read would be cheaper and worse than nothing, both
catalogues having been measured lying in both directions. The rationed lane is excluded — one probe
is 5% of a 20-a-day rung — and observes its own failures beside its counters instead.

**Removal is the Owner's, and it happens on the tap and only on the tap.** The button carries a
value the monitor minted and only the monitor can resolve, so a value a model composed removes
nothing; the tap arrives in System as a `callback_data:` message, the agent passes it back, and the
rung is written out of its lane and landed once the turn is over. It is kept in its own ledger
beside the stand downs, so a redeploy from the authored contract cannot put it back — and unlike a
stand down, nothing is scheduled to return it. A tap on a report older than the unit's own uptime
answers *expired*, and the Owner asks for a fresh report.

Each unit is launched through a wrapper script rather than the binary, generated from the
deployment by `src/cli/install-gateway-agent.ts` and `src/cli/install-search-agent.ts`. A wrapper
sets the `PATH` a supervisor does not provide, opens the capture, and runs the **pre-flight**;
credentials reach the runtime through the secrets store rather than through it, and putting them in
the unit definition would leave live keys in plaintext in a file that is otherwise a tracked
example.

The pre-flight's gating is asymmetric and the asymmetry is the design. It **refuses to start**,
exiting `2`, on a credential ref the runtime cannot resolve, on a scratch root the machine has left
readable, and on a lock or logs directory it cannot make private — each of those being a gateway
that would otherwise come up and be wrong. It **warns and proceeds** on a posture finding from the
secrets audit and on automatic restart after power loss being switched off, neither of which costs
the Owner their chatbot today. A check that always refuses is a check somebody removes.

The search unit's pre-flight is the same shape with its own three checks. It **refuses to start**
when its Python environment is missing or cannot import the package, and when the pinned embedder
export is not in place — every query is embedded before it is answered, so a missing export is not
a narrower search but no search at all, and fetching one here would make an unattended start reach
a network. It **warns and proceeds** when there is no index yet, because the unit has to be up
before a pass can be poked into it.

Every wall-clock schedule — the index passes, the rung watch and sweep, the retrieval report's
delivery, and the morning brief — is a launchd calendar job that pokes a loopback endpoint, rather
than being split between launchd and the runtime's own scheduler. That keeps one auditable answer to
*what can message me unprompted*, and `ls ~/Library/LaunchAgents` is that answer in full.

## Standing a rung down, and pinning one

A **stand down** takes a rung out of its lane until a stated reset. It is `syrax-monitor__stand-down`
in the System chat, and it is Syrax's rather than the runtime's because it changes a lane's
**membership**, which is configuration. It refuses a rung no lane holds, a reset already past, and a
lane's last rung — a lane with no rungs answers nothing.

**The write alone is not the actuator, and the land waits for the turn that asked for it.** A
`channels` write lands itself; an `agents` write, which is what a chain is, is applied when written
and landed only when the turn path is rebuilt. So the tool **answers before the lane is rebuilt** —
that answer is what ends the turn the landing is waiting for — and the landing follows: the gateway
is asked whether anything is in flight (`gateway.restart.preflight`), the channel is stopped and
started once it says no, and the channel is then **asked whether it came back** rather than believed
when it says it did. Roughly thirteen seconds from the reply going out to a verified live channel,
and the sessions survive it.

Every branch that cannot get there ends at `openclaw gateway restart --safe`, which always leaves a
live channel and costs the sessions instead: a gateway still working when the wait runs out, a
channel that will not come back up, or a gateway that will not answer at all. **A stand down that
leaves the Owner's chat deaf is worse than one that costs them a session.**

The sequence opens with an admin call — starting a channel that is already running, which is a
no-op — and that is not cosmetic: the CLI mints this machine's pairing from the scopes of the
**first** method it is ever asked for, and a read-scoped call first leaves every admin call after it,
the safe restart included, refused with *scope upgrade pending approval*.

[ADR-0021](adr/0021-a-config-write-is-applied-when-it-is-written-and-landed-when-a-channel-reloads.md)
and [the measurements](research/landing-an-agents-write.md) carry all of it, including the two things
that do not work: `config.apply` writes the file and reaches no turn, and the same channel reload
issued *inside* the turn asking for it leaves the gateway alive with nothing listening.

**The return is owned, never awaited.** A config write has no expiry, so the rung is written back at
the reset by a timer the unit holds, and the ledger it is kept in outlives that timer: a reset that
passes while nothing is running is honoured on the way back in.

**Startup re-derives the stand downs from that ledger and never from the configuration.** A redeploy
regenerating the file from the authored contract would otherwise silently revert a live stand down,
or silently restore one whose reset has passed; instead the monitor compares the lanes the file holds
against the lanes the ledger implies, and writes and lands the difference. The ledger is
`stand-downs.json` beside the counters.

A **pin** is the apparent opposite and is not one. It forces a *selection* within a lane, it belongs
to the runtime, and it is the Owner's own `/model <provider/model>` typed in the chat. Syrax neither
issues it nor imitates it: standing a rung down to pin another one takes a lane apart to answer a
question about one turn.

## The search unit

Its roots are in the deployment beside the runtime's, and three of them are lists that do three
different jobs. Naming them as one list is the mistake this section exists to prevent.

| Key | What it is |
|-----|------------|
| `searchRoot` | The Python environment, created outside the checkout and installed from `search/requirements.txt` |
| `searchIndex` | The index, the failure ledger and the pinned export — private runtime state, and never inside the checkout |
| `searchPort` | The loopback port the agents reach it on; `18790` unless the deployment says otherwise |
| `indexAllowlist` | The roots that are crawled. A **compute scope**: it is sized by what is worth indexing here, not by what is safe to reach |
| `extractionScope` | Which documents are opened and read — each entry a root **or a glob**, so one root's papers can be scoped to the modules that matter. Outside it, a document is indexed by name alone and a search says so rather than returning silence |
| `blocklist` | What is never indexed, never extracted and never read, **anywhere on the machine** — the only one of the three that is a boundary |
| `searchScopes` | Named roots a chat's connection is bound to. **A name here is a chat's own name**, so the two configurations meet on it and neither can drift; the generator refuses to write a chat whose scope has no root |

The index root and `~/Library` are blocked whether a deployment names them or not: without the
first the index would index its own extracted text, and the second is where the machine keeps its
credential and session stores. Everything else — dotfiles, key and certificate shapes, build and
vendor trees, media-library internals, sparsebundles — is in the code, and a deployment adds the
roots that are this machine's. The blocklist **fails open** where an allowlist fails closed, which
is the price of letting `read` reach outside the allowlist at all: a new private tree becomes
readable the moment it exists unless a pattern already covers it. Revisit it when the machine
changes rather than setting it once.

**The export is fetched once, deliberately.** Nothing in the index or query path reaches a network,
so the pinned model is placed by hand before the unit is first started:

```
node src/cli/install-search-agent.ts <deployment.json>
<searchRoot>/bin/python -m syrax_search fetch-embedder <deployment.json>
```

**Scope is bound per connection, never per call.** Each chat that searches gets an `mcp.servers`
entry of its own pointing at the one resident unit. An agent whose reach is one root carries the
`X-Syrax-Scope` header naming a `searchScopes` entry; General carries none and reaches the whole
allowlist. Were scope a tool argument, the capability boundary would be model-settable and a chat
could widen its own reach in one confused turn.

**The unit serves four tools, and a chat is given its own connection's four or none at all.**
`search` answers with a verdict; `choose` turns a tap on one of its candidates back into a document;
`read` returns a document's text, bounded by the blocklist and not by the allowlist; and `attach`
copies one document to where the chat can send it from. That last one exists because the runtime
uploads a local file only from roots it owns, and the alternative would be a general filesystem read
in the agent's own hands;
[ADR-0026](adr/0026-the-shortlist-is-the-units-and-the-file-is-handed-over.md) argues it. **So the
unit reads `stateDir` too**: handovers are staged under `<stateDir>/media`, and swept on the same
idle beat as everything else the unit holds.

## Logs

Logs go to the `logs` path, outside the checkout with the other private roots, because gateway logs
contain **chat content** — private runtime state by the same definition as the chat archive.

**Rotate them.** An append-only capture grows without bound, so rotation is arranged rather than
remembered. If the volume holding the logs is not mounted, the job cannot open its log and fails
loudly, which is the correct failure: the runtime's state directory is on that volume anyway.

**The runtime writes a log of its own, and its path must be set.** Left unset it lands outside the
`logs` path entirely, which is chat content in the wrong place — but it is no longer only a placement
question, because the lane monitor reads that file to find rotted rungs. Point the runtime's own log
setting at the `logs` path explicitly rather than relying on its default.

**Give it a fixed basename.** A basename shaped like `<name>-YYYY-MM-DD.log` switches the runtime
into rolling mode, where it picks the date itself, reports the configured path in its startup banner
whether or not that is the file it is writing, and prunes every same-prefix log in the directory
older than a day — rotated archives included. The filename the runtime prints by default is of that
shape, so copying it into the setting is the natural mistake.

**Set the rotation size and the redaction level explicitly**, rather than inheriting them. The
default size makes retention several hundred megabytes and time-unbounded, and rotation was asked
for here rather than left to optimism. Redaction is stated because the secrets contract moved to
file-backed refs and a log line is where that assumption gets tested.

**Do not put a second rotator over it.** The runtime already rotates and prunes its own file, and two
rotators over one file lose the window a reader is part-way through. The capture is a different file
with a different writer, named so it falls outside the runtime's prune pattern, and it is rolled at
each start rather than by anything that could reach the runtime's own log.

**The supervisor may not be able to open the capture at all.** On this machine it cannot: launchd
exits `EX_CONFIG` before the job runs when its capture path is on the external volume the logs live
on — with a space in the path and without one alike — while the job's own process writes there
without complaint. So the **wrapper** opens the capture, as its first statement, before any check
that might need to report a refusal. Only the error stream is kept: the runtime's own log is a
measured superset of its output stream, and capturing that too would be a second unrotated copy of a
rotated file.
[ADR-0020](adr/0020-the-wrapper-opens-the-gateways-capture-and-keeps-only-stderr.md) carries the
measurements.

**Create the `logs` path at mode 700.** The runtime creates it with no mode and it lands
world-readable under a default umask, which is wrong for a directory holding chat content. That
belongs to the provisioning wizard or the unit wrapper, beside the secrets directory they already
create at that mode.

Setting the path is [#71](https://github.com/Jerome-Group/syrax/issues/71); the shape is
[ADR-0014](adr/0014-the-runtime-logs-to-a-fixed-basename-and-rotates-itself.md).

## Rolling the runtime pin forward

The runtime is pinned to an exact version, and **the lockfile is the pin**. A tracked
`runtime/package.json` and `runtime/package-lock.json` are installed with `npm ci --prefix` into a
runtime root **outside the checkout**, so the installed tree is never a candidate for a commit.

Rolling forward is deliberate, in this order:

1. Open a pull request bumping the version string, so the change has a diff and a review. The
   lockfile makes the transitive surface diffable too, which matters more than the top-level pin on
   a project that ships releases every few days.
2. `npm ci --prefix <runtime root>` to install from the merged lockfile.
3. `launchctl kickstart -k` the gateway unit.

A global install or a version-resolving runner would work and is not used: neither produces a diff
anybody can review, which is the whole point of pinning.

## Rebuilding and resetting the index

Three operations, and which one to reach for depends on what went wrong.

| Operation | What it does | When |
|-----------|--------------|------|
| Incremental pass | Re-reads documents whose size or modification time changed | Hourly, unattended |
| Full pass | Re-reads every document in the extraction scope, re-embedding only where the extracted text changed | Every third day, unattended; by hand after a document is known to have broken |
| Reset | Deletes the index and rebuilds from nothing | After changing the embedder, the chunking, or the extraction scope — each invalidates every stored vector, and an incremental pass compares size and modification time, neither of which moves when a list does |

The unattended passes are launchd calendar jobs that poke the running unit, so each one uses the
embedder already in memory rather than loading a second copy of it. `com.jerome-group.syrax.index-incremental`
runs at seventeen past the hour; `com.jerome-group.syrax.index-full` runs at 04:30 on the days a
three-day rhythm lands on. launchd counts days of the month rather than intervals, so the one place
that rhythm stretches is the month boundary. By hand, either is:

```
curl --fail -X POST http://127.0.0.1:18790/index/full
<searchRoot>/bin/python -m syrax_search reset <deployment.json>
```

A reindex is HTTP rather than a tool for the same reason scope is not a parameter: it is launchd's
to trigger and no agent's to call.

A reset is safe to run at any time: the index is derived state, and nothing else reads from it. It
costs a full re-embedding of the corpus, which is the only expensive part of any of this.

Extraction failures are recorded rather than dropped. Each failed document lands in a **failure
ledger** beside the index, which the full pass retries and which is reportable in chat — a document
that cannot be read is a fact worth surfacing, not a silent gap in what search can find.

## The retrieval report

A wrong result is marked by **replying to it**, or by the *none of these* tap under a shortlist.
Either way the entry lands in the **retrieval benchmark** — one file under
`<search_index>/benchmark`, holding the fixed queries and the captured misses together, each marked
`fixture` or `live`. What a capture keeps is the verdict and the scores as they stood at the time,
because a rebuilt index destroys them; the correct path is optional, and an entry without one is
*pending* and counted apart.

Every capture records **which of five failures** it was — a confident answer that was wrong, a
shortlist without the answer in it, a shortlist that buried it, an *empty* verdict over a corpus
that held it, or the right document at the wrong size. They are fixed in different places, which is
the whole reason they are told apart.

The set is scored on the three-day re-embed pass and on demand, inside the unit that is already
running rather than in a second process. The report states what the `confident` floor **would** be
if it were re-fitted against the set as it now stands, beside the pinned number and the fixture and
live counts, and **never applies it** — computing the number is reporting, and writing it into
configuration is a person's act with a pull request behind it. It is written to
`<search_index>/benchmark/retrieval-report.json` every run, and posted into System only when a
number moved or a run failed.

**The posting half is the lane monitor's, and it arrives unasked.** The two halves are split by what
each can reach: the search unit holds the numbers and no bot token, and the lane monitor holds the
chat surface and no numbers at all. So `com.jerome-group.syrax.retrieval-report` pokes
`POST /retrieval` on the monitor's loopback port at 57 minutes past the hour, and that beat **reads
the file the pass wrote** rather than scoring anything — a second scoring run would ask a different
index a different question and post a number no pass produced. Nothing new is named in the
deployment for it: the report is found under `searchIndex`, on the layout the search unit's own
configuration derives from that same key.

The beat is hourly because the run it delivers lands whenever a re-embed pass finishes rather than
at an hour a schedule can name. **One scoring run is delivered once, however often it fires**: the
monitor keeps the stamp of the last run it delivered in `retrieval-delivered.json` beside the
counters, and a run already delivered — or one older than it — costs the beat a file read and
nothing else. The stamp is written *after* the post, so a chat surface that could not be reached
leaves the run for the next hour rather than losing it.

```
node src/cli/report-retrieval.ts <deployment.json>
<searchRoot>/bin/python -m syrax_search poke <deployment.json> full
```

The first scores the set and posts the report if it is worth posting; the second asks the running
unit for a re-embed, which is the same pass the three-day schedule pokes and needs no unit of its
own. The command posts through the same delivery the beat uses, so a report it posted is not posted
a second time when the next beat fires. Give the benchmark directory a local `git init` and never push it: nothing else tracks a file
whose entries cannot be reproduced, and the data cannot leave the machine by construction.

### Filling the fixture half

A set with nothing in it scores nothing, so the report has no baseline for a later change to be read
against. The hand-written half goes in with:

```
<searchRoot>/bin/python -m syrax_search seed <deployment.json> <queries.jsonl>
```

Each line of that file is one query. It names the documents that answer it by **fragments of their
path** rather than absolute paths — a person writing the list knows the chapter and not the mount
point, and one chapter is often several documents, so a fragment is how one expectation reaches all
of them:

```json
{"query": "the theorem about semisimple rings", "expect": ["Ch5_Semisimple_Algebras/13_Wedderburn"]}
{"query": "sourdough hydration bulk fermentation", "nothing": true}
{"query": "last term's marked paper", "expect": ["MH1101_Final_2025_Graded"], "scope": "academic"}
```

`nothing: true` asserts that the right answer is *nothing here*, which is what makes a query with no
answer scorable rather than pending — and those are the queries that catch the `empty` floor
drifting. A fragment naming no document the index holds is refused and named rather than skipped,
because an expectation nothing can satisfy is a broken test. A query the set already holds is left
alone: the set accretes and is never rewritten.

Seeding runs each query, so the entry holds the verdict and the scores as the index stands at that
moment — the half a rebuild destroys. A seeded entry carries **no failure shape**: it is a query
kept so a change that breaks it is visible, not a miss somebody marked. Which of them the index
currently fails is the report's `first` and `found`, computed fresh every run.

[ADR-0007](adr/0007-the-retrieval-loop-reports-and-never-retunes.md) carries the reasoning, and the
line it draws.
