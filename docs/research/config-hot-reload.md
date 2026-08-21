# What a write to the generated configuration reaches, and when

**Question:** [ADR-0009](../adr/0009-the-chains-are-recomposed-and-stand-down-is-a-config-write.md)
makes a stand down a config write, *hot-applied, live on the next turn, no restart*. Is that true of
the pinned runtime when the writer is Syrax rewriting its own generated file?

**Answer:** half of it. The write is **applied** — detected, validated and swapped into the running
gateway's configuration — and that is what the log line says. It is not **landed**: the turn path is
rebuilt when a channel reloads, and until something reloads a channel, every turn goes on using the
configuration the gateway last built from. A `channels` write lands itself, because it *is* a channel
reload. An `agents` write does not, and waiting does not help it.

Measured on 2026-08-21 against `openclaw@2026.6.34`: the real gateway, its own generated
configuration rewritten whole under it, and the answer read off the provider wire — which model the
next turn asked for, which provider was reached, and which agent asked.

**Where the numbers come from, and what is pinned.** The elapsed times below were printed by
exploratory runs of this harness, which logged the log lines and the clock.
[`test/config-reload.test.ts`](../../test/config-reload.test.ts) is what survives them, and it pins
the **shape** rather than the timings: that an `agents` write and a `models` write reach no turn on
their own, that a `channels` write lands both within three turns, and that `gateway restart --safe`
lands one that nothing else would. A runtime that starts landing an `agents` write by itself fails
that file. A runtime that merely gets faster does not.

## The four arms

| Written | Log says | The next turns |
|---|---|---|
| `agents.defaults.model.primary` + `fallbacks` | `config hot reload applied (agents.defaults.model.primary, agents.defaults.model.fallbacks)` | **6 turns over 21 s, all on the old model.** A fresh session in another chat: also the old model |
| then `channels…topics.<id>` (nothing about the model) | `config change requires channel reload (telegram) — deferring until 2 reply(ies), 1 embedded run(s) complete`, then `active operations and replies completed; reloading channels now` | **The new route and the model change both land**, on the 2nd turn — the 1st was answered by the old routing |
| `channels…topics.<id>` alone | as above | Old routing at **+2.0 s**, new routing at **+5.1 s** |
| `models.providers.<id>.baseUrl` moved to a second stub | as for `agents` | **3 turns, none reaching the new provider**; the next `channels` write lands it |
| `agents…` then `openclaw gateway restart --safe` | `safe restart requested; gateway will restart momentarily` (exit 0) | **New model at +3.4 s**, and the gateway the suite spawned answered throughout |

The second row is the finding. Nothing in it touches the model; it only forces the channel reload —
and the model change, written 3 seconds and several turns earlier and reported applied at the time,
takes effect at that moment.

## Why an earlier probe concluded the opposite

[#122](https://github.com/Jerome-Group/syrax/issues/122) reported **no reload line of any kind** on
this same seam, and read that as the file never being picked up. Both halves of the mistake are
reproducible, and both are the harness rather than the runtime:

- **It wrote before the watcher attached.** The probe recreated a carrier immediately after `getMe`,
  and the reloader is started at the very end of gateway startup, after it reports itself ready
  (`startManagedGatewayConfigReloader`, called from `dist/server.impl-*.js` after the `ready` mark).
  A write inside that window produces no detection line at all. Reproduced here in reverse: the
  recreation test failed at exactly this, four turns on the old routing, until it took one turn
  before writing.
- **Then it waited on the reload it was itself deferring.** The probe injected a message straight
  after the write, and the channel reload waits for active replies and runs to complete — so the turn
  watching for the change was one of the things holding it up.

## Three things that would otherwise be read wrong

**`config set` says the opposite of what the runtime does.** `openclaw config set
agents.defaults.model.primary …` exits 0 printing *"Restart the gateway to apply."* The file it wrote
was detected and applied by the watcher one second later, exactly as an external rewrite is. Its
advice is right about the effect and wrong about the mechanism, and it is the same advice whichever
way the file was written.

**The watcher attaches after the gateway reports itself ready**, so a write in that window is not
seen at all — no detection line, no application, nothing to defer. Both tests here take one turn
before writing for that reason, and every measurement above was made against an attached watcher.
This is a property of the harness rather than of the deployment: Syrax's own writes happen while the
system is running, not during its first second.

**A whole-file rewrite is not treated as a clobber.** The runtime documents a gate that rejects
destructive external edits — dropping `gateway.mode`, or a file shrinking by more than half
(`docs/gateway/configuration.md`, *Config hot reload*). Syrax writes the generated file entire on
every change, which is the shape most likely to trip it, and it never did: every write above was
detected under the exact key that changed.

## What this is not

It is not a measurement of the **escape hatch** or of the **lane monitor**, which read state rather
than write configuration. And it says nothing about what a restart costs the Owner **in flight**: the
runtime documents `--safe` as preflighting active work and restarting once it drains, and no turn was
in flight when it was measured here, so that half is read rather than observed.
