# The runtime logs to a fixed basename, and rotates itself

> **Amended in part by [ADR-0015](0015-the-scratch-root-stays-in-tmp-and-the-preflight-asserts-its-mode.md)**
> — the scratch root's contents are narrower than the section *This moves the log, and not the
> scratch root* states. The voice-waveform scratch it names is Discord's, not the generic
> message-send path, and the browser and Codex writers beside it are extension-gated too. **Amended
> in part by
> [ADR-0020](0020-the-wrapper-opens-the-gateways-capture-and-keeps-only-stderr.md)** — there are no
> launchd captures, so the rotation ownership split below has one side and not two.

The gateway's own log is placed by the runtime's `logging.file` key, at
`/Volumes/RAID0/104 Syrax/logs/openclaw.log` — a **fixed** basename — and the runtime rotates it.
`newsyslog` covers launchd's captures and nothing else.

This amends the **Logs** section of
[ADR-0005](0005-launchd-supervises-syrax-as-two-launchagents.md), and amends its substance rather
than its wording. That section named one mechanism, launchd's `StandardOutPath`, and there are
**two** log surfaces. The placement decision reached the stream launchd captures and never reached
the file the runtime opens for itself — so gateway logs were landing on the internal disk under
`/tmp/openclaw/` the whole time the record said otherwise.

Everything below is measured against the pinned `openclaw@2026.6.34`
([#71](https://github.com/Jerome-Group/syrax/issues/71)), on
[#45](https://github.com/Jerome-Group/syrax/issues/45)'s precedent that the shipped doc and the
shipped code disagree.

## It is a configuration key, not a wrapper trick

`logging.file` is honoured verbatim — the resolver is the configured value or the default, with only
`~` expansion, and a path containing a space is fine. Its default resolves under the runtime's own
scratch root, which is how this went unnoticed: nothing failed, the log simply existed somewhere
nobody had decided.

## The basename decides the behaviour, and the obvious filename is the trap

This is the finding that makes a fixed basename a decision rather than a default.

The rolling-mode test is on the **basename alone** — an `openclaw-` prefix, a `.log` suffix, and
exactly the length of `openclaw-YYYY-MM-DD.log`. Point `logging.file` at anything of that shape and
the runtime switches modes, and all three consequences are bad:

- **The configured date is ignored.** Only the directory is taken; the runtime writes today's date.
- **The startup banner prints the configured path**, which under a rolling config is the *stale*
  one. The gateway's own line about where its log lives is wrong on every day but one.
- **The prune eats archives.** Everything matching `openclaw-*.log` in that directory older than 24
  hours goes, by mtime and whatever its shape — measured taking a rotated archive
  (`openclaw-2026-08-17.1.log`) along with the decoys. That is a 24-hour retention floor that
  deletes its own history.

**This matters because the wrong filename is the one already on screen.**
`/tmp/openclaw/openclaw-2026-08-18.log` is what the gateway prints today, so copying it into the
config is the natural move. A fixed `openclaw.log` instead gives `openclaw.1.log` … `openclaw.5.log`
beside it, the sixth dropped, and **no prune ever runs**. It appends across restarts rather than
truncating.

## Rotation ownership splits, and the `newsyslog` entry is per-file

The runtime rotates its own file — `maxFileBytes`, five numbered archives. **`newsyslog` covers only
launchd's `StandardOutPath` / `StandardErrorPath`.**
*(Spent — [ADR-0020](0020-the-wrapper-opens-the-gateways-capture-and-keeps-only-stderr.md).)*

Two rotators over one file is how a reader loses the window it is mid-way through, and
[ADR-0012](0012-a-rotted-rung-is-reported-and-never-repaired.md) made that a real cost rather than a
tidiness argument: the lane monitor parses this file to find rotted rungs, keyed on inode and size.
So the `newsyslog.d` entry is **per-file, not a `logs/*` glob** — a glob is how this fails silently
the next time a file appears in that directory.

The launchd captures are named `gateway.out.log` / `gateway.err.log`, which keeps them outside the
`openclaw-*` prune pattern.
*(Spent, on there being two —
[ADR-0020](0020-the-wrapper-opens-the-gateways-capture-and-keeps-only-stderr.md).)* That costs
nothing today and forgives a later switch into rolling mode.

## Two settings are stated rather than inherited

```json
{
  "logging": {
    "file": "/Volumes/RAID0/104 Syrax/logs/openclaw.log",
    "maxFileBytes": 26214400,
    "redactSensitive": "tools"
  }
}
```

**`maxFileBytes` at 25 MB**, because the default of 100 MB makes retention 600 MB and
**time-unbounded**. ADR-0005 asked for rotation rather than optimism, and leaving a size unstated is
the same answer as optimism. 25 MB × 6 holds months while staying rotation-rare, which is what the
lane monitor's offset wants.

**`redactSensitive` at `"tools"`**, which *is* the default — stated anyway because
[ADR-0010](0010-one-secrets-store-reached-by-file-backed-refs.md) moved the secrets contract to
file-backed refs, and a log line is the one place a resolved key could still surface. An assumption
worth testing is worth writing down.

## `logs/` is created at 700, and not by the runtime

The runtime creates the log's directory recursively with **no mode**, so under the default umask it
lands at 755 — measured. Contrast its scratch root, which it explicitly tightens to 700.

Gateway logs contain chat content, which is private runtime state by `CONTEXT.md`'s definition, so
755 is wrong for the same reason ADR-0005 put `logs/` on the volume beside `secrets/` in the first
place. **Creating it at 700 belongs to the wizard or the wrapper**, beside the `secrets/` directory
they already create at that mode.

## This moves the log, and not the scratch root

Worth stating because the fix looks bigger than it is. With `logging.file` pointed elsewhere,
`/tmp/openclaw` **came back on the very next start** — empty, mode 700. It is not the log directory;
it is the runtime's whole scratch root, it is not configurable, and browser downloads, traces,
voice-waveform scratch on the message-send path and the Codex CLI's last-message file all resolve
under it.

That is [#92](https://github.com/Jerome-Group/syrax/issues/92), and it is a different question with a
different answer. Inbound channel media is **not** among them — that already goes to the state
directory ADR-0005 placed on the volume.

## Consequences

- **The log is a depended-upon interface now, and this record is what keeps it in one place.**
  ADR-0012 accepted the coupling; this makes the path, the basename and the rotator part of the
  contract. A later change to any of the three breaks the lane monitor rather than merely moving a
  file.
- **Retention is stated, and it is not small.** 25 MB × 6 is up to 150 MB of chat content on the
  volume, unencrypted — the volume ADR-0005 left unencrypted deliberately, and that trade is
  unchanged rather than re-opened here.
- **A second rotator is now a specific mistake rather than a general worry.** The `newsyslog.d`
  entry names two files. Anyone widening it to a glob re-introduces exactly what this record was
  written to prevent.
- **`ADR-0005`'s Logs section is superseded in substance but not annotated in place**, per
  [ADR-0001](0001-decisions-are-recorded-as-adrs.md) — it takes the pointer forward and keeps its
  reasoning, which is what makes the original mistake legible.

## Revisit when

- **The pin moves.** The rolling-basename test, the prune window, the archive count and the defaults
  are all properties of `openclaw@2026.6.34` and none of them are contractual.
- **The runtime makes the scratch root configurable**, or #92 answers it another way. The two
  questions were separated here on the evidence that they are separate; that could stop being true.
- **The lane monitor stops reading this file** — if the runtime ever exposes chain health directly,
  ADR-0012's reader goes and the rotation argument reverts to hygiene.
- **A second consumer wants the log.** One reader keyed on inode and size is why the ownership split
  works. Two would need the question re-asked.
