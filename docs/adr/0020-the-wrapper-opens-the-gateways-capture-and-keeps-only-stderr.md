# The wrapper opens the gateway's capture, and keeps only stderr

The gateway's LaunchAgent names **no** `StandardOutPath` and **no** `StandardErrorPath`. The wrapper
opens the capture itself, in the `logs/` directory
[ADR-0005](0005-launchd-supervises-syrax-as-two-launchagents.md) placed on the volume, keeps
**stderr alone**, rolls it past 5 MB with one previous copy beside it, and sets `umask 077` before
anything else runs. No `newsyslog.d` entry is installed, here or anywhere.

**This amends [ADR-0014](0014-the-runtime-logs-to-a-fixed-basename-and-rotates-itself.md)** — its
rotation-ownership split has no subject left, because there are no launchd captures to cover — and
answers the **Logs** section of ADR-0005 on the mechanism rather than on the placement.
**Placement is not re-opened**: the capture stays beside `openclaw.log`, which is where chat-adjacent
content belongs and where the runtime already writes.

Everything below is measured on the mini, macOS 27.0 (`26A5388g`), against the pinned
`openclaw@2026.6.34`.

## launchd will not open a capture on that volume, and it is the volume

The finding, and it was not the one being looked for.

Bootstrapped with the two capture paths under `104 Syrax/logs/`, the job never ran: `runs = 2`,
`last exit code = 78: EX_CONFIG`, both files absent, and nothing in either the runtime's log or the
directory. The same plist with the captures moved to `/tmp` came up `state = running` and answered.

That leaves two candidates — the volume, or the space in `104 Syrax`. A third bootstrap separated
them, with the captures in a **spaceless** directory on the same volume,
`/Volumes/RAID0/syrax-probe-logs/`: `EX_CONFIG` again. So it is `/Volumes/RAID0`, an **External**
device by `diskutil`, and not the space, and not the job — which had already been proved good by
running the same wrapper by hand, where it started the gateway and wrote `openclaw.log` to the very
directory launchd had refused.

**The process can write there; launchd cannot open a file there on its behalf.** Every other
LaunchAgent on this machine captures into `~/Library/Logs`, so nothing in the house was a
counter-example, and this is why the mistake was available to make at all.

## The wrapper is already the answer to what launchd will not do

ADR-0005 invokes a wrapper because a plist cannot carry credentials and does not set `PATH`;
[ADR-0010](0010-one-secrets-store-reached-by-file-backed-refs.md) added the audit and
[ADR-0015](0015-the-scratch-root-stays-in-tmp-and-the-preflight-asserts-its-mode.md) and
[ADR-0017](0017-the-gateway-lock-directory-is-not-relocated-and-the-preflight-creates-it-at-0700.md)
the mode checks. Opening the capture is the same shape: a thing the supervisor cannot do, done by
the process it supervises.

It is the **first** statement in the wrapper, before every check, so that a pre-flight refusal lands
in the file rather than in `/dev/null` — a LaunchAgent with no capture path discards both streams.
One failure stays invisible by construction: a `logs/` directory that cannot be created, which is
the volume being unmounted, and which ADR-0005 already calls the correct loud failure.

## Only stderr is kept, because the other stream is a copy of a rotated file

Measured over one start: the runtime's own log carried **34** messages, its stdout **19** lines, and
**every** stdout line appeared among them. The log is a superset, it is structured, and ADR-0014
already rotates it at 25 MB × 6.

Capturing stdout would therefore be a second, **unrotated** copy of a file that is rotated — which
is the thing ADR-0005 asked for rotation to prevent, arrived at from the other direction. What the
runtime's log does *not* have is the wrapper's own output: the pre-flight's refusals and warnings,
and whatever kills the process before it can log. That is stderr, and that is what is kept.

So one basename survives ADR-0014's pair, `gateway.err.log`, still outside the runtime's own
`openclaw-*` prune pattern.

## Rotation is a roll at start, and `newsyslog` is out entirely

The wrapper renames the capture to `gateway.err.1.log` when it is already 5 MB, then appends. One
previous copy, which is what a crash loop needs and no more.

This is not a second rotator over the runtime's file — the coupling
[ADR-0012](0012-a-rotted-rung-is-reported-and-never-repaired.md) made expensive and ADR-0014
protected. The two files have one writer each, and the lane monitor's is untouched.

It rolls **only at a start**, so a gateway that runs for months appends to one file for months. That
is accepted rather than overlooked: the writers are the pre-flight's handful of lines per start and
a fatal trace, and a system where that file grows is a system restarting often enough to roll it.

`newsyslog` is not used at all, because nothing is left for it to cover. One thing is worth a later
reader's attention and is **not measured**: a `newsyslog.conf` line is whitespace-delimited with no
quoting, so this logs path may not be expressible in one regardless — `newsyslog` refuses to parse
anything without root, so it could not be dry-run here.

## `umask 077`, once, rather than at each caller

The capture landed at **644** under the inherited mask before this was set, in a directory at 700.

ADR-0014 already recorded the general shape of that fault — the runtime creates its log directory
with no mode and it lands 755 — and answered it for one directory. The mask answers it for every
file and directory anything under the wrapper creates, which is the whole of what a gateway writes.
The pre-flight's own `chmod` calls stay, because they are assertions about directories that may
already exist, and a mask does not reach those.

## Consequences

- **The LaunchAgent's two capture keys are now a mistake to add**, not an omission to fix. A later
  session reading ADR-0005's `StandardOutPath` sentence will reach for them; this record and the
  plist's own absence of them are what should stop it.
- **A capture written by the job rather than by launchd is lost if the wrapper dies before its
  first statement.** That is a `bash` that cannot start, which is not a failure mode this system
  can report on anyway.
- **`umask 077` reaches the runtime too**, and the runtime is a large program with its own
  expectations about the files it writes. Nothing has been observed to mind. If something does, it
  will look like a permissions error inside the runtime and not like a decision made here.
- **Observed while proving the restart:** the runtime exits **0** when port 18789 is already in use,
  and `KeepAlive` is `SuccessfulExit=false`, so launchd does not bring it back. A gateway left over
  from a foreground run therefore keeps the supervised one down, silently, until the port is free.
  Recorded rather than acted on — the case is a hand-run gateway, and ADR-0017 established that the
  lock's port probe already treats a free port as the authority.

## Revisit when

- **The logs move off the external volume**, or the volume stops being external. The whole record
  turns on `EX_CONFIG` at that placement; the capture keys become available again the moment it
  changes.
- **The pin moves.** The superset measurement is a property of `openclaw@2026.6.34`'s console and
  file logging, and a release that logs something to stdout alone would make dropping it lossy.
- **macOS changes what launchd will open.** `EX_CONFIG` on an external volume is a measurement on
  macOS 27.0, not a documented contract.
- **Anything else starts writing to the capture** — a second sidecar under the same wrapper, or a
  runtime that begins using stderr in volume. The roll-at-start bound assumes the current two
  writers.
