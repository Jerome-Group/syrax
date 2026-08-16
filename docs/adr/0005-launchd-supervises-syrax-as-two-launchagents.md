# launchd supervises Syrax as two LaunchAgents

Syrax runs on the mini under **launchd**, as **two LaunchAgents** — not containerised, and not one
process. `com.jerome-group.syrax.gateway` runs OpenClaw; `com.jerome-group.syrax.search` runs the
resident MCP search service [ADR-0004](0004-syrax-owns-the-file-search-index.md) built. Both take
the `com.tracearr.server` shape already in the house: `RunAtLoad`, `KeepAlive` with
`SuccessfulExit=false`, a `ThrottleInterval`, and a wrapper script rather than the binary as the
program.

[ADR-0003](0003-the-runtime-adapter-wraps-openclaw.md) deferred two things here by name — "how the
pin is supervised and rolled forward is a deployment question", and measuring the steady-state
footprint "under real load". Both land below, and the second **amends** ADR-0003 rather than
restating it.

## Not a container, and memory is the weakest of the three reasons

The house has both patterns, and the media stack's is the tempting one: eleven containers on
`restart=unless-stopped`, with Beszel already running on loopback and watching them for free.
`runtime-candidates.md` had already struck a candidate over Docker Desktop's VM being a poor tenant
on a 16 GB shared machine, and that still holds — the colima VM is allotted 6.2 GB and holds 2.4 GB
resident. But it is the weakest reason, because it is the one a bigger machine answers.

The **corpus spans two volumes and the home directory**. ADR-0004's index reaches
`/Volumes/RAID0`, `~/Documents/Zotero`, `~/Desktop` and `~/repos`. In a container each of those
becomes a bind mount, and the **blocklist** — the one list ADR-0004 calls a real boundary rather
than a compute scope — would then be enforced partly by mount topology instead of by the indexer's
own walk. That is the failure shape ADR-0004 rejected when it refused to satisfy a requirement
through a wrapper, and it is worse here, because a mount is invisible from the code that is
supposed to be enforcing the rule.

And the colima profile is named **`torrent`**, owned by media-server, its socket under
`103 Media Stack`. Tenancy there couples Syrax's uptime to the media stack's lifecycle — the exact
coupling [#9](https://github.com/Jerome-Group/syrax/issues/9) drew a boundary against when it ruled
that a capability's own product owns its tool layer.

## Two units, because four agents would otherwise mean four embedders

The load-bearing detail, and the one the default MCP wiring gets wrong.

MCP's normal transport is stdio: the client spawns the server as a child process. Syrax has **four
agents** ([#11](https://github.com/Jerome-Group/syrax/issues/11)), so the default would put **four
ONNX embedders resident** on a machine already deep into swap.

So the search service is standalone, bound to loopback, and the four agents connect to it. One
model in memory regardless of agent count, and it survives a gateway restart rather than re-paying
the model load — which is the cost ADR-0004 built a resident server to avoid in the first place.
The unit boundary is therefore not tidiness: it is one unit per resident thing that must exist
exactly once.

## Reboots: the constraint was FileVault, and it was removed

The question was how this survives a reboot. Measured first, and the answer was not launchd:
**FileVault was on with no auto-login**, so a cold boot stopped at the unlock screen with
`/Volumes/RAID0` unmounted and no `gui/` session — meaning neither a LaunchAgent *nor* a
LaunchDaemon would have started. `org.jeromegroup.boot-watchdog` is `RunAtLoad` and **had never once
fired on a cold boot**, because there was no login to load at.

What reframed it: **`/Volumes/RAID0` is unencrypted**, and so is `Media Server`. Only the internal
disk and the Time Machine volume were protected. Everything Syrax handles — `providers.env`, the
117 M-character plaintext index, the chat archive, and the corpus itself — was already in the clear
on a drive that can be unplugged. FileVault was protecting the login keychain, `~/.ssh`,
`~/.config/gh`, browser sessions and `~/Library`: real, but **not this system's data**.

The Owner turned FileVault off and enabled auto-login on that basis, and it was verified afterwards:
FileVault `Off`, the internal disk still `Encrypted at rest` through Apple Silicon's hardware
encryption, `autoLoginUser` set, screen lock `immediate` and now the real boundary, the login
keychain unlocked with `no-timeout`, and RAID0 mounting at boot unaided.

**Encrypting `/Volumes/RAID0` is the higher-value security change of the two**, given where the data
actually is. It is a machine-wide posture affecting media-server and everything else on the mini,
nothing in Syrax v1 depends on it, and it is out of scope here rather than forgotten.

### Auto-login and Touch ID unlock are mutually exclusive

Documented nowhere obvious, and the first reading of it during the grilling was wrong, so it is
recorded here rather than left to be rediscovered.

**It is auto-login that enforces the exclusion, not FileVault.** The two coexisted on this machine
before the change — FileVault measured `On` alongside biometric unlock enabled. The rule is in
Apple's own Touch ID & Password pane, which says *"Turn off automatic login to continue."* and
offers a **Turn Off Automatic Login** button. No setting restores lock-screen unlock while
auto-login stands.

**Enrolment is untouched.** Apple Pay biometrics stayed enabled and `pam_tid` remains configured in
`/etc/pam.d/sudo`, so Touch ID keeps working for `sudo`, password managers, autofill and Apple Pay.
Only the lock screen loses it. That was accepted knowingly once the exclusion was established: the
lock screen is a manual event on a machine whose `sleep`, `displaysleep` and `disksleep` are all
`0`, and unattended recovery is the standing requirement.

### The rejected alternative

`sudo fdesetup authrestart` buys one unattended boot with **no security concession**, and would have
covered both restarts in the window `wtmp` retains. It was set aside because it is a step a human
must remember before every restart, and it cannot be scripted without storing the FileVault password
somewhere — which is the concession it existed to avoid.

## What the design actually covers

| Failure | What brings Syrax back |
| --- | --- |
| A process crashes | `KeepAlive` with `SuccessfulExit=false` |
| Kernel panic | macOS's own restart, then auto-login and `RunAtLoad` |
| Power loss | `pmset autorestart 1` — **and only that** |
| Unattended cold boot | Every precondition verified; the boot itself **not yet observed** |

**The power-loss row was a hole found and closed here.** `pmset` reported `autorestart 0`, so the
mini would have stayed dark after a cut and auto-login would never have got a boot to skip. It was
set to `1` and verified. One adjacent flag moved with it — `autorestartatconnect` went `1 → 0`,
which costs nothing on a desktop always on mains.

What remains uncovered is a cut long enough to matter rather than a blip, because nothing here turns
a hard loss into a clean shutdown. That is a UPS: hardware, and outside this decision.

**Cold-boot recovery is verified only in its preconditions.** Nothing has watched this mini come
back unattended. The tell on the next restart is `boot-watchdog` writing to its log with nobody
having logged in — and until that is seen, this row is a design intention rather than a measurement.

## Nothing new watches Syrax

Beszel is already running and the answer is still no. It watches a host that is, by definition, up
whenever it could observe anything — and `com.tracearr.healthcheck` sitting at exit status 1,
unremarked, is that gap in the flesh.

Instead, ntulearn's
[ADR-0013](https://github.com/Jerome-Group/ntulearn/blob/main/docs/adr/0013-the-watchdog-is-a-local-scheduled-two-layer-run.md)
argument is reused: **absence is the signal**. Syrax is a chat surface, so its death is evident
within one message — a property no nightly batch job has. And
[#10](https://github.com/Jerome-Group/syrax/issues/10)'s never-silent 07:00 brief is already a daily
heartbeat: a morning with no brief means Syrax is down. No observer for the observer.

## launchd owns every wall-clock schedule

Three exist: the hourly incremental reindex, the three-day OCR retry pass
([ADR-0004](0004-syrax-owns-the-file-search-index.md)), and the 07:00 brief
([#10](https://github.com/Jerome-Group/syrax/issues/10)). OpenClaw has its own scheduler and the
brief must run through it, so these could have split across two systems. They do not.

Every schedule is a launchd calendar job that pokes a loopback endpoint — the index jobs call the
search service, the brief calls the gateway. Two reasons, and the second is the one that matters.
The index jobs get the resident embedder instead of loading a second copy per run, which is the
whole point of the standalone service. And the standing constraint is that proactive messages come
**only from schedules the Owner set** — one `LaunchAgents` directory and `launchctl list` is an
auditable inventory of them. Split across two systems, *"what can message me unprompted?"* stops
having a single answer.

`StartCalendarInterval` rather than `StartInterval`, following ntulearn's ADR-0013: a calendar job
catches up when the Mac wakes past its time.

## The pin is a lockfile, and the keys never enter the plist

**Install.** ADR-0003 required that upgrading be a deliberate change with a diff and a pull request.
A global `npm i -g` lands in `/opt/homebrew` on the internal disk and produces no diff;
`npx openclaw@<version>` re-resolves and caches internally. Neither is a pin anyone can review.

So the repository tracks `runtime/package.json` and `runtime/package-lock.json` — **the lockfile is
the pin** — and `npm ci --prefix "/Volumes/RAID0/104 Syrax/runtime"` installs from it.
`node_modules` never enters the checkout: placement rather than an ignore rule, which is how
ADR-0004 already states this repository's rule. Roll-forward is a pull request bumping one version
string, then `npm ci` and `launchctl kickstart -k`. The lockfile also makes the **transitive**
surface diffable, which matters more than the top-level pin on a project shipping calendar releases
every few days.

**Secrets.** `providers.env` is mode 600 under `104 Syrax/secrets/`. launchd's
`EnvironmentVariables` would put five live keys in plaintext inside `~/Library/LaunchAgents/` and
destroy the plist's ability to be a tracked example. So the plist invokes a wrapper —
`104 Syrax/bin/start-gateway.sh` — which sources the env file and `exec`s the runtime. This is not a
new pattern: `com.tracearr.server` already runs a shell script rather than a binary. The wrapper is
also where the `PATH` launchd does not provide gets set, which is the failure `boot-watchdog`'s own
comment calls out by name.

The plists therefore ship as tracked examples,
`config/com.jerome-group.syrax.{gateway,search}.example.plist`, following ntulearn's equivalent.
Label convention is `com.jerome-group.<product>.<unit>`, which the two newest agents on the machine
already use; `org.jeromegroup.*` and `com.jeromequeck.*` are older drift and are not followed.

## The footprint budget is amended, on two axes

ADR-0003 set "a steady-state resident set of 4 GB for the gateway" and deferred measurement here.
Both changes below are **amendments to that budget**, not restatements of it.

**Its subject widens** from the gateway to every `com.jerome-group.syrax.*` unit, summed. This
decision split Syrax into two resident processes plus periodic index jobs, and a 16 GB machine does
not care which of them took the memory.

**Its force softens at the start.** There is no cap at launch. 4 GB is what the deployment is
designed toward, and the number becomes real at a **7-day steady-state measurement** — not at
startup, because both the embedder and the session state grow into their footprint.

ADR-0003's distinction survives intact: exceeding the budget opens a **re-evaluation with
measurements attached** and still does not auto-swap the runtime to ZeroClaw.

## Logs

`/Volumes/RAID0/104 Syrax/logs/` — a fourth sibling beside `secrets/`, `runtime-state/` and
`search-index/`. Nothing makes a log file the technically-impossible case that would justify the
internal disk, and the house habit of `~/Library/Logs/` is drift rather than a reason.

Two consequences taken deliberately. Gateway logs will contain **chat content**, which is private
runtime state by `CONTEXT.md`'s definition, so rotation is a `newsyslog.d` entry rather than
optimism — launchd's `StandardOutPath` appends without bound. And if RAID0 does not mount, the job
cannot open its log and fails loudly, which is the correct failure: the state directory is on that
volume anyway.

## Consequences

- `config/syrax.example.toml` carries a `logs` placeholder path beside the existing private roots,
  and `docs/configuration.md` carries the two units, the log destination and its rotation, and the
  pin roll-forward procedure.
- The glossary gains **gateway**, because two loopback processes were sharing one word.
- `boot-watchdog`'s enablement note in `media-server` is now stale in one of its two premises: it was
  written when a reboot also needed a human at the keyboard. That is
  [media-server#260](https://github.com/Jerome-Group/media-server/issues/260) rather than an edit to
  another repository's ADR from here, which is how two records start disagreeing. The 8 TB HDD
  re-seat fault it names is unfixed, so this removes one of its two reasons and does not unblock it.

## Revisit when

- **The 7-day steady-state measurement lands**, which is when the footprint budget acquires force
  and either confirms the two-process shape or opens ADR-0003's re-evaluation.
- **An unattended cold boot is actually observed**, which converts the last row of the failure table
  from a design intention into a measurement — or falsifies it.
- **A UPS appears**, which is the only thing that turns a long power cut into a clean shutdown.
- **The machine's encryption posture changes** — encrypting `/Volumes/RAID0` would revisit both the
  FileVault trade and the plaintext-index reasoning above.
