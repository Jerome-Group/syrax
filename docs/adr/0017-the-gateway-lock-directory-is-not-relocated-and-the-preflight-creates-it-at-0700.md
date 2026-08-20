# The gateway lock directory is not relocated, and the pre-flight creates it at `0700`

The runtime's **second** scratch directory — `os.tmpdir()/openclaw-<uid>`, where
`acquireGatewayLock` writes the gateway lock file — stays where it is. The wrapper's pre-flight
**creates** it at `0700` and then asserts it, exiting `2`. No reaper, no corrupt-lock check, and
[ADR-0005](0005-launchd-supervises-syrax-as-two-launchagents.md)'s failure table gains no row.

**This amends [ADR-0015](0015-the-scratch-root-stays-in-tmp-and-the-preflight-asserts-its-mode.md)
in one part.** That record's *"The scratch surface is larger than one directory"* section noted this
directory at mode `755` holding locks with dead pids, and deferred it by name; this is that answer,
and it extends the same pre-flight. Everything else in ADR-0015 stands: its acceptance of
`/tmp/openclaw`, its technically-impossible argument, and its reading that the RAID0 constraint
reaches what Syrax *stores* are the ground this rests on and are not re-opened here.

Everything below is measured against the pinned `openclaw@2026.6.34`
([#92](https://github.com/Jerome-Group/syrax/issues/92)), driving `dist/gateway-lock-G25QtHgv.js`
directly with an injected `lockDir`, `env` and `port` so every branch taken is the shipped one.

## The `755` is an omission, not a policy

`acquireGatewayLock` — `src/infra/gateway-lock.ts` — resolves the directory as
`resolveGatewayLockDir()` = `os.tmpdir()/openclaw-<uid>`, and the file as
`gateway.<sha256(configPath) sliced to 8>.lock`.

The call that creates the directory is `fs.mkdir(path.dirname(lockPath), { recursive: true })` with
**no `mode`**, so `umask` decides. Measured against `umask 022`: acquisition into a directory that
does not exist creates it at **755**, with the lock file at **644**.

That is a different path from `resolvePreferredOpenClawTmpDir`, which ADR-0015 measured *creating*
at `0700`. The two directories differ not because one was judged less sensitive but because one call
passes a mode and the other does not. Nothing chose `755` here.

It is reached in v1's configuration, and not only on `--local`: the sole caller is `runGatewayLoop`
in the `gateway` run path, which is the thing ADR-0005's LaunchAgent starts.

## Unlike ADR-0015's root, this directory takes the setting

`os.tmpdir()` reads `TMPDIR` live. Measured: with `TMPDIR` set, `resolveGatewayLockDir()` returns
`<TMPDIR>/openclaw-501`.

ADR-0015's whole argument — *there is no compliant configuration, and that is the whole argument* —
therefore **does not extend to this directory**, and this record says so explicitly because the two
sit one section apart and a later reader would otherwise inherit the impossibility by proximity.
Declining to relocate this one is a **choice**, argued below, rather than an escape clause being
invoked a second time.

## The port probe is what makes a stale lock harmless, and it runs first

The ticket that raised this assumed a stale-lock sweep was the mechanism. It is not. `runGatewayLoop`
always passes `lockPort`, and `resolveGatewayOwnerStatus` opens with
`if (port != null) { if (await checkPortFree(port)) return "dead" }` — so a free gateway port
classifies the lock's owner **dead before `isPidAlive` or the `ps` argv check is consulted at all**.

| lock owner | gateway port | result |
| --- | --- | --- |
| dead pid — the real Aug-17 lock, replayed | free | **acquired**, 3 ms |
| dead pid | occupied | **acquired**, 2 ms |
| live pid, non-gateway argv — PID recycling | occupied | **acquired**, 5 ms |
| live pid, non-gateway argv | free | **acquired**, 1 ms |
| **live pid, genuine gateway argv** | **free** | **acquired**, 3 ms |
| live pid, genuine gateway argv | occupied | refused after 5,001 ms |
| live pid, genuine gateway argv | probe disabled | refused after 5,003 ms |

Rows six and seven are the positive control: a process whose `ps -o command=` really is
`…/openclaw -e … gateway`, which `isGatewayArgv` accepts. The lock does refuse when it should.

Under `KeepAlive` the port is free by definition at the moment launchd relaunches, so **no lock with
a dead owner can ever refuse a start.** That is the finding that empties the worry this came from.

### The cost, which ADR-0015 could not have known

**Row five.** The port probe *overrides* a correctly-identified **live** gateway: a second gateway
that holds the lock but has not yet bound `18789` is classified dead and has its lock taken from it.

So the single-gateway guarantee is really a **single-listener-on-18789 guarantee**. For v1 — one
LaunchAgent, one port — that is fine and nothing here depends on the difference. It is recorded
because it is not what the name says, and a later reader adding a second gateway or a second port
would otherwise rely on a guarantee that was never being made.

## One branch does delay a start, and it is bounded

A lock whose payload the schema cannot parse **never reaches the port probe at all**:
`readLockPayload` returns `null`, so `ownerPid` is undefined and `resolveGatewayOwnerStatus` is
never called. Status is `unknown`, and the only escape is mtime age past `staleMs` (30 s).

- unparseable, mtime 20 s old → **refused** after 5,001 ms
- unparseable, mtime 60 s old → **acquired**, 0 ms
- valid JSON missing `pid` (schema fail), mtime 60 s old → **acquired**, 2 ms

Under `KeepAlive`'s 10 s throttle that costs two or three restarts and clears itself in **~30–40 s**.
Reaching it at all needs a kill landing between `open(lockPath, "wx")` and the payload write — every
other error path in that block `rm`s the lock on the way out.

This is the reason ADR-0005's failure table gains no row. It is a start that is *delayed* and
self-heals, not a start that cannot start, and a table row would imply an operator action where
there is none.

## Orphaning is permanent, and that is not "reaping is missing"

Reaping is lazy **and keyed by config path**. The filename hashes `configPath`, so the three locks
found on the mini hash `prototype-57-WIPE-ME/openclaw.{secretref,interp,fileref}.json` — paths v1
will never compute again. Nothing ever tries to acquire *those* paths, so nothing ever reaps them,
and ADR-0015 established that nothing sweeps `$TMPDIR` on this macOS.

**Every config-path change therefore strands one lock file forever.** In v1 that is one path, so the
steady state is one live lock and zero orphans — which is why the finding changes nothing here and
is recorded anyway: it is a property of the mechanism, not of v1's luck.

## The decision

1. **Nothing is relocated.** `TMPDIR` is a process-wide setting, so using it would move *every*
   `os.tmpdir()` consumer rather than this directory alone — and it would tie the gateway's scratch
   to the volume whose unreadability is still open fog on the map. A lock file is coordination state
   with a `release()` that deletes it, which is the same side of ADR-0015's storage line as a
   temporary workspace.
2. **The pre-flight creates the directory at `0700`, then asserts it**, exiting `2` on failure —
   beside ADR-0015's assertion on `/tmp/openclaw` and
   [ADR-0010](0010-one-secrets-store-reached-by-file-backed-refs.md)'s secrets audit.
3. **No reaper and no corrupt-lock check.** The runtime reaps its own live-config lock in
   single-digit milliseconds on the path launchd actually takes, so a wrapper reaper would duplicate
   it. The one thing a wrapper check could buy is the ~30–40 s above, for a kill inside a
   microsecond window — ADR-0015's *machinery out of proportion* line applied to its own neighbour.
4. **ADR-0005 is unchanged**, for the reason given above: the only branch that can delay a start
   self-heals.

### Ensure-then-assert, and the measurement that makes it work

Point 2 is deliberately a different shape from ADR-0015's **assert-then-refuse**, and the difference
is measured rather than stylistic: `mkdir(recursive)` **does not chmod an existing directory**.
Verified `700` before acquisition and `700` after. So a directory the pre-flight pre-creates at
`0700` survives the runtime's own `mkdir` intact, and the lock files' `644` stops mattering once the
directory containing them is closed.

Asserting alone would not do here. ADR-0015's root is created by a resolver that already makes it
`0700`, so there is something to assert on a first run; this directory does not exist until
something acquires a lock, and asserting on a missing directory would either fail every cold start
or have to tolerate absence — which is the case the `755` comes from.

## The alternative that was declined, and what would justify it

**Deleting a lock file that is not valid JSON.** It removes the delayed-start branch entirely, and
it is safe by construction: an unparseable payload can never be a lock a live gateway holds, because
a live gateway's lock parses.

It is declined only on proportion, so the trigger is low: **add it the first time a delayed start is
actually observed.** That is a concrete observation rather than a judgement — two or three
`KeepAlive` restarts with no other explanation, ~30–40 s before the gateway comes up.

## Consequences

- **The wrapper's pre-flight now touches the filesystem rather than only reading it.** ADR-0015's
  check and ADR-0010's audit both only look; this one creates a directory before it asserts. That is
  a new kind of thing for the pre-flight to be doing, and the justification is one measured fact
  about `mkdir(recursive)` — if that fact changes with the pin, the shape has to be re-argued rather
  than patched.
- **The single-gateway guarantee is narrower than its name**, and this record is where that is
  written down. Nothing in v1 depends on the difference.
- **One orphaned lock file per config path, forever**, on a `$TMPDIR` nothing sweeps. Accepted at
  one path; it becomes visible the first time anything routinely varies the config path.
- **ADR-0015's escape clause is not invoked twice.** This directory takes `TMPDIR` and is kept in
  place by choice, which keeps the technically-impossible precedent at exactly one use.

## Revisit when

- **The pin moves.** The absent `mode`, the port-probe-first ordering, `staleMs`, the
  `sha256(configPath)` filename and the `mkdir`-does-not-chmod behaviour are all properties of
  `openclaw@2026.6.34` and none of them are contractual.
- **A delayed start is observed.** That is the declined corrupt-lock check's trigger, above.
- **Anything routinely varies the config path** — a second config, a per-environment path, a
  wrapper that writes a generated config. The orphan count stops being zero and the lazy reaper
  stops being sufficient.
- **A second gateway or a second port appears.** The single-listener-on-18789 reading becomes
  load-bearing at that moment, and the port probe's override of a live owner turns from a note into
  a defect.
- **The runtime passes a `mode` to that `mkdir`.** The pre-flight's ensure step becomes redundant
  and should be reduced to an assertion, matching ADR-0015.
