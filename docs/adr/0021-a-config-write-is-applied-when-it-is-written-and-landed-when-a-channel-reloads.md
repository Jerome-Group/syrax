# A config write is applied when it is written, and landed when a channel reloads

> **Its own revisit trigger has fired, and what replaced the mechanism is measured.** *"A supported
> way to land an `agents` write without a restart appears"* was measured for #128:
> [`docs/research/landing-an-agents-write.md`](../research/landing-an-agents-write.md). `config.apply`
> — the candidate named below — is a **writer, not a lander**. A `channels.stop` + `channels.start`
> pair *is* one and keeps the sessions, and it must be **deferred until the turn that asked for it is
> over**: issued mid-turn the stop times out, the start does nothing, and the channel is left down
> with the gateway alive. Deferred and verified — wait on `gateway.restart.preflight`, reload, then
> confirm on `channels.status` — it lands on the next turn with the sessions intact, which is what
> #128 builds. The restart below is now the **fallback**, and the half this record called unmeasured
> is measured: under a turn in flight it defers until the work drains and the reply arrives at the
> moment it would have anyway.

## What ADR-0009 got right, and the half it did not

[ADR-0009](0009-the-chains-are-recomposed-and-stand-down-is-a-config-write.md) is not overturned.
Its structural finding — that a stand down overrides *membership* and belongs to Syrax, where a pin
overrides *selection* and belongs to the runtime — is untouched, and so is the argument that a config
write can express a daily rung where a chain member cannot. **A stand down is still a config write.**

What is spent is the timing claim hanging off it: *live on the next turn*. It is not. The next turn
uses the configuration the gateway last built from, and it goes on doing so until something rebuilds.
ADR-0009 could not have seen this from what it measured: `openclaw config set` was the writer, and
that command **prints "Restart the gateway to apply."** on exit — so a reading that restarted before
looking would have seen the change live and drawn exactly this conclusion.

The two claims are marked in place in ADR-0009's body under
[ADR-0018](0018-a-spent-claim-in-an-adr-body-is-marked-in-place.md), because a reader arriving at
that section from an issue would otherwise read a live promise.

## Why the lander is a restart rather than a nudge

A `channels` write lands itself, so the write path that recreates a cleared carrier
([ADR-0013](0013-a-chats-existence-is-syraxs-not-the-owners-furniture.md)) needs nothing added: it
writes `channels`, and the reload follows. That is the cheap case and it is already correct.

The stand down is the expensive case, and it writes `agents`. Two landers were available and only one
of them is honest:

| | |
|---|---|
| **`gateway restart --safe`** | **Chosen.** The runtime's own command, exit 0, and the stood-down rung was gone 3.4 s later. It is documented as preflighting active work and restarting once it drains — read rather than measured, and not what the choice rests on |
| a `channels` no-op written beside the real change | **Rejected.** It works, and it works by accident: it lands the `agents` write as a side effect of pretending a channel changed. Nothing about it would survive the runtime tightening its reload planning, and nothing in the code would say why the no-op was there |

What the restart costs is the sessions, which is a real cost and a smaller one than serving a rung
Syrax has already decided is spent. ADR-0009 valued the hot apply partly because *stand down no
longer drops in-flight turns*, and `--safe` is documented to drain rather than kill — but that half
is unmeasured here, so it is a reason to prefer `--safe` over a plain restart rather than a plank
this decision stands on.

## Consequences

- **A stand down is a write plus a safe restart**, and #128 builds it that way. A stand down that
  writes and stops is a stand down that does not happen.
- **The carrier recreation needs nothing**, and its first message is the whole of the cost. The
  reload is deferred until turns in flight drain, so the message that triggered the recreation can
  still meet the old routing and be answered as General — ADR-0013's standing rule for an
  unrecognised thread id — with the next one landing on the chat's own agent.
- **`config hot reload applied` is not evidence that anything changed.** Anything reading the
  runtime's log for confirmation — the lane monitor most of all — reads that line as *the file was
  accepted* and never as *the lane changed*.
- **The window before the watcher attaches is real but not ours.** The watcher is the last thing the
  gateway starts, after it reports itself ready, and a write inside that window is not seen at all.
  Syrax writes while the system is running, so this bites the tests rather than the deployment, and
  both of them take a turn before writing.

## Revisit when

- **The pinned runtime moves.** This is a behaviour of `2026.6.34` and none of it is documented — the
  runtime's own reference says `channels.*`, `agents` and `models` hot-apply, with no mention that
  two of them need the third. The Dependabot bump to `2026.7.1` is open as
  [#134](https://github.com/Jerome-Group/syrax/pull/134), and re-running
  `test/config-reload.test.ts` against it is the cheapest possible check: the suite fails loudly if
  an `agents` write starts landing on its own.
- **A supported way to land an `agents` write without a restart appears.** The gateway's config RPC
  (`config.apply`) was not measured here, and it is the obvious candidate. That would make the
  restart the fallback rather than the mechanism, and would give #128 back the sessions.
- **Sessions start costing more than a stale rung.** The restart's price is the sessions it drops.
  Nothing at v1 keeps anything in them worth protecting; a memory system would change that, and the
  balance with it.
