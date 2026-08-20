# The scratch root stays in /tmp, and the pre-flight asserts its mode

> **Amended by [ADR-0017](0017-the-gateway-lock-directory-is-not-relocated-and-the-preflight-creates-it-at-0700.md) in one part, and its
> deferral on the second directory is spent.** The deferral first: **"The scratch surface is larger
> than one directory"** below hands `os.tmpdir()/openclaw-<uid>` to
> [#108](https://github.com/Jerome-Group/syrax/issues/108) as noted-and-not-decided, and ADR-0017 is
> that answer — so the section reads as an open question only if read on its own. The amendment
> proper is to **"There is no compliant configuration"**, whose *"the only other path the resolver
> will ever return is a user-scoped `os.tmpdir()/openclaw-<uid>`, which is the same internal disk"*
> holds by default but not by construction: that path **does** take `TMPDIR`. The
> technically-impossible argument is therefore true of `/tmp/openclaw`, which is what this record
> decides, and is not general — ADR-0017 declines to relocate by choice rather than by
> impossibility. Everything else below is untouched.

The runtime's scratch root remains the hardcoded `/tmp/openclaw`. No symlink, no sweep, no fork of
the pinned build. The wrapper's pre-flight is to assert the directory is mode `0700` before the
gateway starts, because the runtime creates that mode without enforcing it. That assertion is what
this decision buys and it is not built yet; nothing else changes.

This is the first time the standing *everything installs and stores under `/Volumes/RAID0`;
the internal disk only when technically impossible* constraint has had its second clause invoked.
It is invoked here as an argument rather than assumed as an excuse, which is what this record is
for.

Everything below is measured against the pinned `openclaw@2026.6.34`
([#92](https://github.com/Jerome-Group/syrax/issues/92)), on
[#45](https://github.com/Jerome-Group/syrax/issues/45)'s precedent that the shipped doc and the
shipped code disagree.

[ADR-0014](0014-the-runtime-logs-to-a-fixed-basename-and-rotates-itself.md) moved the gateway's log
and explicitly handed this on as a different question; this is that answer. It **amends that record
in part**, and takes the pointer forward per
[ADR-0001](0001-decisions-are-recorded-as-adrs.md): ADR-0014's account of what the scratch root
carries is wrong in the direction that made this look urgent, and the correction is below.

## There is no compliant configuration, and that is the whole argument

`POSIX_OPENCLAW_TMP_DIR` is the literal string `/tmp/openclaw`. There is no environment override —
`OPENCLAW_TMP_DIR` occurs in the build only as a substring of that constant — and no configuration
key. The only other path the resolver will ever return is a user-scoped
`os.tmpdir()/openclaw-<uid>`, which is the same internal disk.

So the constraint admits **no** configuration that satisfies it. A constraint with no compliant
configuration is not being broken here; it is invoking its own escape clause. The clause exists
precisely for a dependency that does not take the instruction, and this is one.

Naming that matters more than the outcome. The clause has been available since the constraint was
written and has never been used, so the first use sets what counts: *the software will not take the
setting*, demonstrated by reading the pinned build — not *the setting was inconvenient*.

## The RAID0 constraint reaches what Syrax stores

Stated here for the first time, because it decides this record and generalises past it.

`CONTEXT.md` defines private runtime state as credentials, sessions, chats, memory, provider
responses, caches, logs and machine-specific paths, and requires that it **stay outside the
repository**. `/tmp` satisfies that. The RAID0 line is the separate constraint, and it is about
placement of what Syrax *stores*.

A temporary workspace that is `rm -rf`'d in a `finally` is an intermediate, not storage. Reading the
constraint to cover every byte the runtime ever writes would make it unsatisfiable — every `ffmpeg`
invocation would breach it, with no configuration available to comply — and a rule that cannot be
obeyed stops being read as a rule. The narrower reading is the one that keeps its force where it
matters: the index, the secrets store, `runtime-state/`, the logs.

## The exposure is one file, on one explicit gesture

[#92](https://github.com/Jerome-Group/syrax/issues/92) listed thirty-eight modules resolving paths
under the scratch root. What survives sorting them by source region is much smaller.

**Most of the named writers are extension-gated.** The voice-waveform PCM scratch reached from
`message-handler.process` and `reply-delivery` — which read like the generic send path and were the
reason this looked urgent — are `extensions/discord/src/monitor/*`, and the waveform belongs to
Discord's voice-message feature. The browser's downloads, uploads and traces are `extensions/browser`;
the Codex bridge's `last-message.txt` is `extensions/codex`. The rest of the list is `canvas`,
`feishu`, `imessage`, `zalouser`, `device-pair`, `llm-task`, `active-memory`, `migrate-hermes` and
two speech providers. A Telegram-only v1 reaches none of them.

**The core writers v1 does reach delete themselves.** `src/media/*` and `src/media-understanding/*`
fire whenever the Owner sends a photo, PDF or voice note into a chat, and every one of them goes
through `withTempWorkspace` / `tempWorkspaceSync`, which removes its directory in a `finally` and
additionally registers it for removal at process exit. One qualification, recorded because it is
unmeasured: the exit sweep is a `process.once("exit", …)`, which a `SIGTERM` from launchd does not
necessarily reach — so the `finally` is the guarantee and the exit hook is a second-best.

`/export-session` and `/export-trajectory` were checked specifically, a session export being far
worse than a waveform: both take an explicit output path and never touch the scratch root.

**What is left is `openclaw-context-map-<uuid>.png`** — a bare `writeFile` with no `finally` and no
exit registration, and the only call to the resolver in the entire chat-command bundle.

It renders **only** on the `/context map` subcommand; plain `/context` returns text and writes
nothing. And **it cannot be disabled**: `commands.allowFrom` gates *who* may run elevated commands,
not *which* commands exist, and in a single-user system the Owner is the who. That is accepted. A
standing sweep to guard a file that appears when the Owner asks for a picture of their own context
is machinery out of proportion to the thing it guards.

## The symlink is refused, and it fails silently

This is why the attractive option is not taken, and the silence is the reason rather than the
refusal.

Run against the shipped resolver with injected `lstat` and `access`:

| `/tmp/openclaw` is… | result |
| --- | --- |
| a symlink, owned by us | **refused** → `os.tmpdir()/openclaw-<uid>`, **no warning emitted** |
| a real directory at mode 755 | **accepted** |
| a real directory owned by another uid | refused → same fallback |

`isTrustedTmpDir` tests `!st.isSymbolicLink()` on an `lstat`, and the repair path refuses a symlink
too. A symlink therefore does not fail loudly and leave the system where it was — it **relocates the
scratch to a different place on the internal disk and says nothing**. The failure mode is a record
that says one thing and a filesystem doing another, which is exactly what ADR-0014 was written to
end.

That also disposes of the user-scoped fallback as a deliberate choice. It is not an alternative
placement; it is what a failed symlink lands on by accident.

## The concern is readability, and placement was a proxy that fails here

The resolver **creates** at `0700` and rejects only group-or-other **write** (`st.mode & 0o22`). A
world-readable `0755` scratch root passes its safety check untouched. `0700` is a default, not an
enforced property.

Which means moving the scratch to `/Volumes/RAID0` would have bought nothing on the axis that
actually matters. The runtime does not enforce readability wherever the directory sits, and the
volume is unencrypted by [ADR-0005](0005-launchd-supervises-syrax-as-two-launchagents.md)'s
deliberate choice — [#18](https://github.com/Jerome-Group/syrax/issues/18) turned FileVault off and
ruled encrypting the volume out of scope.

So the decision buys the property directly instead of through placement:

**The wrapper's pre-flight asserts `/tmp/openclaw` is mode `0700`, and refuses to start
otherwise.** The mode is the whole assertion — ownership and type are the runtime's own resolver's
job, and it does both. Same place and same shape as
[ADR-0010](0010-one-secrets-store-reached-by-file-backed-refs.md)'s audit, which already exits `2`
on an unresolved secrets ref. A refusal to start is the right severity for the same reason it is
there: a gateway that runs with its scratch readable is worse than one that does not run.

## No macOS mechanism sweeps it

Recorded so this record does not imply a sweeper that does not exist.

On **macOS 27.0** (`26A5388g`), `periodic` is **gone entirely** — no binary, no `/etc/periodic`,
no `com.apple.periodic-*` daemon — so the `110.clean-tmps` mechanism that used to clear `/tmp` is
not running. The only launchd job on the system referencing tmp cleanup is `com.apple.bsd.dirhelper`
(03:35 daily, `CLEAN_FILES_OLDER_THAN_DAYS=3`), and the filesystem argues it does not reach
`/private/tmp`: files there carried mtime *and* atime four days old having survived two of its runs,
while the user `$TMPDIR` held 5,625 entries older than three days.

The only bound on residue is the runtime's own recreate-empty-on-start, measured in
[#71](https://github.com/Jerome-Group/syrax/issues/71). That makes the bound **uptime**, and uptime
on a 24/7 resident mini is long — thirteen days when this was measured. The decision does not change
on that, because the thing being bounded is one PNG on an explicit gesture. But nothing here leans
on macOS, and a later reader should not think it does.

## The scratch surface is larger than one directory

Noted and deliberately not decided. `/var/folders/…/T/openclaw-<uid>` exists on the mini at mode
`755`, holding gateway lock files with dead pids, written by a path that is not this resolver — which
would have created it at `0700`. That is
[#108](https://github.com/Jerome-Group/syrax/issues/108), and its subject is supervision rather than
placement. The locks carry `pid`, `createdAt` and `configPath` and no credentials, so what they
raise is a lock outliving its process under `KeepAlive` rather than anything about Owner content.

## Consequences

- **The technically-impossible clause now has a precedent, and it is a demanding one.** The next
  invocation is measured against this: a build read, an absent key demonstrated, alternatives tried
  and reported. That is deliberate — the clause is the constraint's only escape, and a cheap first
  use would have made it a general-purpose exemption.
- **A `/context map` leaves a PNG on the internal disk until the gateway next restarts.** Accepted,
  on a single-user machine with the directory at `0700`. It is the one thing this record trades away,
  and it is named so the trade is visible rather than discovered.
- **The pre-flight gains a check that can refuse a start.** Under ADR-0005's `KeepAlive` that is a
  restart loop if it ever fires, which is the intended severity — but it is a new way for the
  gateway not to come up, and it belongs in the same failure table.
- **`0700` is now asserted rather than trusted**, which also covers the case the runtime tolerates:
  a scratch root left world-readable by something other than the runtime.
- **Nothing is moved.** ADR-0005's placement decision and ADR-0014's log placement are untouched;
  this record is the boundary of how far that placement reaches, not a change to it.

## Revisit when

- **The runtime makes the scratch root configurable.** The entire argument is that no compliant
  configuration exists. One key ends this record.
- **The pin moves.** The hardcoded constant, the symlink refusal, the `mode & 0o22` check, the
  `withTempWorkspace` cleanup and the `/context map` gating are all properties of
  `openclaw@2026.6.34` and none of them are contractual.
- **v1 enables any of the extensions this record excused** — browser, Codex, Discord, Talk voice.
  The exposure was sized on a Telegram-only tool layer, and each of those puts named Owner content
  back under the scratch root.
- **macOS changes underneath this.** The sweep argument is a property of macOS 27.0 on this
  machine, not of macOS. An OS upgrade can reintroduce a `/tmp` cleaner or change `dirhelper`'s
  reach, and the section above should be re-measured rather than re-read.
- **The volume gets encrypted**, which #18 ruled out of scope. That would make placement buy
  something it does not buy today, and the readability-not-placement argument would need re-asking.
- **A `SIGTERM` is measured leaving media workspaces behind.** The `finally` is the guarantee relied
  on here; if launchd's stop is shown to bypass it under load, the self-deleting claim narrows.
