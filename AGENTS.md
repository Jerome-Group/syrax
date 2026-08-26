# AGENTS.md — Syrax

> Canonical instruction file for AI agents (Claude Code and others) working in this repo.
> `CLAUDE.md` is a symlink to this file, so the two can never drift.

## What this repo is

Syrax is the public, MIT-licensed reference repository for the Owner's personal chatbot system:
its architecture, setup contract, safe examples, and future runtime adapters. It does not contain
private conversations, credentials, authenticated sessions, private memory, or machine-local
runtime state.

- **Visibility:** public
- **Organisation:** [Jerome-Group](https://github.com/Jerome-Group)

## Getting it running

The current baseline is documentation-first. No agent runtime has been selected and there is no
launch command yet. Read [`README.md`](README.md), then [`docs/system-overview.md`](docs/system-overview.md),
[`docs/setup.md`](docs/setup.md), and [`docs/configuration.md`](docs/configuration.md) before adding
an adapter. Use [`config/syrax.example.toml`](config/syrax.example.toml) only as a public contract;
put live values and runtime state outside the repository.

## Conventions

- Default branch: `main`.
- Domain glossary lives in `CONTEXT.md`; decisions are recorded as ADRs in `docs/adr/`.
- Public examples use placeholders. Secrets enter through the deployment environment or another
  private secret store, never through tracked configuration.
- Keep the private runtime root outside this checkout. Do not place chats, memory, sessions, logs,
  or provider responses under a path that can be committed.
- Keep secrets out of the repo. **Never commit a token.** The conformance check scans every pull
  request for one, and it fires after the push — so a caught credential is burned: rotate it
  first, then clean up. The full response is in `CONTRIBUTING.md`.

## Judging an instruction change

**A change to a standing instruction has no effect on the chat session that was running when it
landed.** Starting a fresh one — `/new` in that chat — is a precondition of judging the change,
not a troubleshooting step to reach for once it looks inert.

Carry the mechanism rather than the ritual, because it reaches cases this paragraph did not
anticipate. The instruction arrives as project context injected from the agent's workspace when
a session starts. A session already under way carries its own history instead, and in that
history sit the model's own earlier tool calls — and an in-context example outweighs an
instruction, reliably. So a model that has already emitted a malformed call goes on copying its
own earlier attempt, however the instruction now reads. The new text is not in the window it is
reading.

[#204](https://github.com/Jerome-Group/syrax/issues/204) is where this was measured, in the
trajectories and the runtime log. What it cost is four pull requests over one capability —
[#195](https://github.com/Jerome-Group/syrax/pull/195),
[#199](https://github.com/Jerome-Group/syrax/pull/199),
[#201](https://github.com/Jerome-Group/syrax/pull/201) and
[#203](https://github.com/Jerome-Group/syrax/pull/203) — each shipping an instruction change and
each judged in the chat that was already open. Those wordings were being guessed as well, which
[ADR-0033](docs/adr/0033-the-shortlist-is-a-message-and-the-owner-says-a-number.md) records and
this does not replace. That is the trap rather than a caveat on it: two failures that look
identical from the chat, and a session that cannot see the new text cannot tell them apart.

`src/adapter/instruction.ts` composes the text this is about.

## Code standards

`CODING_STANDARDS.md` is the full version: the burden is on the code, not on docs — names,
placement and small cohesive units carry the *what*, and docs carry only the *why*. `MAP.md` is
required at the root and updated in the same pull request as any top-level change.

## How work flows

`CONTRIBUTING.md` here is the full version — the Organisation's, copied so it is a file an agent
can read. In short: an issue first, then a pull request; no commit lands on `main` directly.

**A change to this repository's files is finished when its pull request is open — not when the
commit exists.** Branch, commit, **push, and open the pull request**, without asking whether to;
nothing is merged by them. This outranks any instruction that stops earlier — a skill whose last
step is "commit your work" has described the middle of the job. It reaches file changes and
nothing else: a session that changes no file owes no pull request, and the only other thing that
stops you is the author saying, here, that they want the commit alone.

Before you stop, every acceptance criterion you satisfied is ticked on the issue and every one you
did not is left unticked and explained — `docs/agents/acceptance-criteria.md`.

## Commit & PR attribution

Every commit **you write**, and every pull-request body, ends with an `Assisted-by:` trailer —
plus a `Co-authored-by:` for a model whose vendor address is verified — as its **last,
contiguous** lines. Wrote it yourself? Then it is `Assisted-by: none`, never no trailer at all.
The commits GitHub writes are not yours either: the squash on `main` and the merge the **Update
branch** button makes are the platform's text, so the check skips a merge commit and is never run
over `main`. Both are argued in ADR-0040 and ADR-0041 **in the management hub**, whose numbering is
not this repository's. The full rule and the verified allowlist are in
`CONTRIBUTING.md`; an effort suffix is recorded only when one is explicitly set, and a mode
(Ultracode) is never recorded as one.

## Agent skills

### The route through the skills

Where a piece of work starts, what hands on to what, and where research and prototypes live. See
`docs/agents/workflow.md` before inventing a route.

### Issue tracker

GitHub Issues on this repository, via the `gh` CLI. `docs/agents/issue-tracker.md` carries the
operations, including wayfinding (`/wayfinder` falls back to local markdown without it).

### Labels

Thirteen, and the set is closed — `docs/agents/triage-labels.md`. Every issue carries exactly one
state and one category. The hub's Terraform owns the set, so a label added here by hand is deleted
by the next apply and one removed by hand comes back.

### Acceptance criteria

Ticked on the issue, never falsely; what could not be done is a not-doing line in the pull-request
body, and the drift block has a fixed shape. See `docs/agents/acceptance-criteria.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Dependency updates

Surfaced at both ends of any session that touches a pull request — `docs/agents/dependencies.md`,
which is mirrored from the Organisation and is not edited here. Note its **first** merge condition:
this repository auto-merges nothing until it opts in, and a skeleton CI has not earned that.

Two things are this repository's own. Its *required check is green* condition **does not hold for
`tokenizers` or `onnxruntime`**, which CI never installs — `CODING_STANDARDS.md` §6 says what to run
instead. And bring a stale bump up to date with `@dependabot rebase` rather than
`gh pr update-branch`: the latter writes a merge commit the trailer check judges as yours, and
Dependabot then refuses to rebase a branch it considers edited, so the way back is
`@dependabot recreate` on every one you touched.

## Repository notes

The runtime adapter is intentionally undecided. Record that implementation decision in a new
`docs/adr/` record when it becomes concrete.
