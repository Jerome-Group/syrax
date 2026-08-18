# One secrets store, reached by file-backed refs

Every Syrax credential lives in **one JSON store** under `104 Syrax/secrets/`, reached through the
runtime's SecretRef mechanism with `source: "file"`. Nothing resolved is ever written down: the
generated `agents/<id>/agent/models.json` carries the marker `secretref-managed` and no key.

This is not an acceptance of the second copy [#57](https://github.com/Jerome-Group/syrax/issues/57)
found — it removes it, and the mechanism that removes it also takes the keys out of the gateway's
process environment.

Measured against the pinned `openclaw@2026.6.34` rather than read from documentation, and the
premise turned out **narrower than it was stated**. Inline `apiKey: "${VAR}"` does persist the live
key to `models.json` at mode 600 inside a 700 directory, exactly as recorded — but **only the gateway
writes that file**. Embedded `--local` runs create sessions and stop, which is why #39's finding did
not reproduce on disk, and why a byte-scan of the whole runtime root, `~/.openclaw` and
`/tmp/openclaw` finds the two env files and nothing else. **There is no residue to scrub: the
contract lands before the deployment does.**

## Why `file` and not `env`, which is the decision

Both are SecretRef and both keep the resolved value off disk. What they **persist** differs, and the
documentation hides it: a non-env source writes the literal marker `secretref-managed`, while an
**env-backed source writes the bare environment variable name** — and `isNonSecretApiKeyMarker`
recognises that only for names in a 61-entry set assembled from provider manifests.

| persisted marker | recognised as non-secret |
|---|---|
| `CEREBRAS_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | yes |
| `ZAI_API_KEY`, `GROQ_API_KEY`, `TELEGRAM_BOT_TOKEN` | **no** |
| `secretref-managed` | always |

The known set contains **no name for Groq or Z.AI at all**, so renaming to a canonical variable is
not available as a fix. Under `source: "env"`, `secrets audit --check` would report
`PLAINTEXT_FOUND` against two of five providers, permanently, over values that are not secrets.

That is what decided it. **A gate that always fires is a gate nobody reads**, and the audit is the
only thing standing between this contract and silent drift. A posture check with two permanent false
positives is worse than no check, because it teaches its reader to skip the output.

Worth stating so it is not mistaken for a milder version of the same thing: **`${ENV_VAR}` in the
config is not a weak form of SecretRef — it is not SecretRef at all.** The audit reports it as
plaintext in `openclaw.json` itself, alongside the generated copy. Two findings, one cause.

## Two properties a sourced `.env` cannot have

- **The keys never enter the process environment.** A live turn returned `200` with no provider key
  exported at all — both providers file-sourced, the process started with `env -i`. A credential that
  is never a variable is never inherited by a child process.
- **The store fails closed on permissions.** At mode 644 the ref resolves to `insecure-permissions`
  and the runtime refuses; at 600 it resolves. A sourced `.env` at 644 is read without complaint.

That second property is the one that makes a single file safer than a single file plus whatever the
runtime decided to persist beside it: the protection is checked at the moment of use rather than
assumed at the moment of writing.

## What this amends in ADR-0005

[ADR-0005](0005-launchd-supervises-syrax-as-two-launchagents.md)'s *Secrets* paragraph has the plist
invoke a wrapper that sources the env file and `exec`s the runtime, so the credentials reach the job
through the environment. **That is no longer how provider credentials arrive.**

**The amendment is to the mechanism, not to the reason.** `EnvironmentVariables` in the plist is
still refused, on ADR-0005's own argument; what changes is that the wrapper is no longer the thing
carrying the secret past it.

The wrapper keeps `PATH` and gains a third job: `openclaw secrets audit --check` before `exec` —
read-only, working with the gateway down. **The gating is deliberately asymmetric.** It **refuses to
start on exit 2**, because an unresolved ref means a runtime that comes up and refuses every turn,
which is worse than not coming up. It **logs and proceeds on exit 1**, because a posture finding
should not cost the Owner their chatbot. CI cannot run this check — real credentials under a private
root — so the wrapper and a schedule are the only two places it can run at all.

## Rotation is a store write plus a restart, chosen rather than suffered

A running gateway caches the resolved value: after rotating the store under a live process, the next
turn was `401`. A cold start on the same state dir served the rotated key.

`secrets reload` exists as a gateway RPC and is **gated behind device pairing** — *device is asking
for more scopes than currently approved* — a scope this single-user system has no other reason to
grant. So rotation is complete when the wizard writes the store and runs `launchctl kickstart -k`,
and **nothing needs scrubbing afterwards**, which is the whole of what was asked.

This inverts [#45](https://github.com/Jerome-Group/syrax/issues/45)'s finding rather than
contradicting it: there the CLI advertised a restart that was not needed, here a restart genuinely
is. Different subsystems, same lesson — the runtime's own claims about restarts are worth measuring
in either direction.

## The other secrets on that volume

`telegram.env` folds into the same store: the bot token sits on the same supported surface and the
audit counts it as a resolvable ref. The search index has none — ADR-0004 embeds locally, and the one
remote surface that would have applied is unused.

The sweep surfaced a **sixth secret nobody had counted**: `gateway.auth.token`. Unset, the runtime
generates a fresh one per startup, which would break every loopback poke ADR-0005 gave the wall-clock
schedules; set inline, it is plaintext in config and the audit says so. It joins the store.

## `secrets configure` and `secrets apply` are never used

ADR-0003 made the adapter a **configuration contract**, and a config produced through an interactive
picker is not a contract anyone can diff. `configure` requires a TTY, which an unattended
provisioning path cannot offer, and `apply` scrubs one-way with no rollback backup — with nothing to
scrub, since no plaintext copy was ever written to this machine. Syrax hand-writes its refs and runs
`audit` alone.

## Consequences

- `config/syrax.example.toml` and `docs/configuration.md` carry the store's placeholder path and the
  SecretRef shape, since the store is now part of the public contract rather than a local detail.
- The provisioning wizards write the JSON store rather than `providers.env` and `telegram.env`, and
  each doubles as the rotation path — so each ends with the `kickstart` rather than with the write.
- A rotation that skips the restart looks like a revoked key: the gateway keeps answering `401` with
  a correct credential sitting in the store. The wizard owning both halves is what prevents it.
- The audit's asymmetric gating means a plaintext finding can persist across restarts, logged and
  unfixed. That is the deliberate half of the trade, and the reason exit 2 is treated differently.
- `CONTEXT.md` gains **secrets store** and **credential marker**, landed in the same session as the
  decision.
- Beyond this record's subject and filed separately: the runtime opens a log of its own at
  `/tmp/openclaw/`, outside ADR-0005's log placement and its rotation entry —
  [#71](https://github.com/Jerome-Group/syrax/issues/71).

## Revisit when

- **The runtime's marker manifest gains canonical names for Groq and Z.AI.** That is the single fact
  this decision turns on; with it, `source: "env"` becomes auditable and the choice is worth
  re-reading rather than assumed.
- **`secrets reload` stops requiring device pairing**, or this system acquires that scope for another
  reason — which would make rotation restart-free and retire the `kickstart`.
- **A credential appears that the SecretRef surface does not cover.** The contract's value is that
  there is exactly one place any of them is written; a second store, however small, is the failure
  this record exists to prevent.
