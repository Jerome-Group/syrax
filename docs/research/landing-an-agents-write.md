# Landing an `agents` write without restarting the gateway

**Question:** [ADR-0021](../adr/0021-a-config-write-is-applied-when-it-is-written-and-landed-when-a-channel-reloads.md)
found that an `agents` write is *applied* and not *landed*, and named the gateway's config RPC —
`config.apply` — as the obvious candidate for a lander that is not a restart. Is there one in the
pinned runtime?

**Answer:** yes, but it is not the one the ADR named. `config.apply` and `config.patch` are
**writers, not landers**: both wrote the file, both returned `ok`, and neither reached a turn. The
lander is **`channels.stop` followed by `channels.start`** on the channel — two admin-scoped
gateway RPCs, no config write and no restart. It landed the chain change on the **first turn after
the pair**, and the session survived it: the prompt that turn carried still held a message sent
before the landing.

`channels.start` **on its own does not land it.** The stop is the half that matters; the start
without it is a no-op against a running channel.

Measured on 2026-08-24 against `openclaw@2026.6.34`, the pinned runtime, by the same method
ADR-0021 used and for the same reason: a real gateway with local Telegram and provider stubs, the
generated configuration rewritten under it, and the answer read off the provider wire — which model
the next turn asked for. `config hot reload applied` is not evidence, and none of the verdicts below
rest on a log line.

## The four arms

Each arm stood its own gateway, took one turn before writing (the watcher attaches after the gateway
reports itself ready), then wrote `agents.defaults.model.primary` + `fallbacks` from the Gemini rung
to the Mistral one, and asked which model the next turns were sent to.

| Arm | The call | The turns after it |
|---|---|---|
| the file rewritten, then **`channels.stop` + `channels.start`** (`{"channel": "telegram"}`) | both exit 0, `{"stopped": true}` / `{"started": true}` | 3 turns on the old model before the pair; **the new model on the 1st turn after it** |
| the file rewritten, then **`channels.start` alone** | exit 0, `{"started": true}` | **3 more turns on the old model.** It does not land |
| **`config.patch`** as the writer (`raw` + `baseHash`, `replacePaths`) | exit 0, `ok: true`, and the file on disk carried the new chain | **6 turns, all on the old model** |
| **`config.apply`** as the writer (the whole file, `raw` + `baseHash`) | exit 0, `ok: true`, and the file on disk carried the new chain | **6 turns, all on the old model** |

The last row is the ADR's candidate, and it is a clean negative. `config.apply` replaces the whole
config and returns the config it wrote; the running turn path is not among the things it rebuilds.
The runtime's own reload planner is why, and it is readable in the shipped code: in
`dist/config-reload-plan-BEiDUFmq.js`, `agents.defaults.model` matches a rule of kind `hot` whose
only action is `restart-heartbeat`. Nothing puts a channel in `plan.restartChannels` except a path a
channel plugin claims through `reload.configPrefixes` — which is to say, a `channels` write. Whoever
writes the file, the plan is the same, so the RPC writers land exactly as much as an external
rewrite does: nothing.

## Why the stop/start pair is the same lander, reached honestly

The hot-reload handler's channel reload (`dist/server-reload-handlers-BVBmx8_d.js`, `applyHotReload`)
*is* `await params.stopChannel(name, …)` then `await params.startChannel(name)`. The
`channels.stop` and `channels.start` RPC handlers (`dist/channels-DiU05pSq.js`) call
`stopChannelAccount` and `startChannelAccount`, and `channels.start` builds its config from
`context.getRuntimeConfig()` — the hot-applied in-memory config, not the one the channel was last
built from. So the pair is the reload ADR-0021 measured, minus the pretence that a channel changed.

That distinction is the whole of it. ADR-0021 rejected a `channels` no-op written beside the real
change because *"nothing in the code would say why the no-op was there."* A `channels.stop` and a
`channels.start` say what they are.

## What the pair costs, and what it does not

- **Not the sessions.** After the landing, the prompt the next turn carried still contained a message
  sent several turns before it (10 messages in the request body, the pre-landing one among them).
  This is the thing a `gateway restart --safe` spends and this does not.
- **It does not drain.** The reload path waits for active replies and embedded runs before it stops a
  channel (`waitForActiveWorkBeforeChannelReload`); the RPC handlers do not — they stop the account
  when asked. Read from the shipped code, not measured. A turn in flight when `channels.stop` lands
  is at risk in a way it is not under a config-driven reload or under `--safe`.
- **The channel is down between the two calls.** Two CLI invocations here, roughly a second apart.
  What Telegram does with a message sent into that window is not measured: the stub queues an update
  until a poll takes it, and the real Bot API's `getUpdates` backlog is a different thing.

## Three things the surface will otherwise be read wrong on

**The docs say `agents` needs no restart, and that remains true and useless.** `docs/gateway/configuration.md`
lists `agent`, `agents`, `models`, `routing` under *Restart needed? No*, and `docs/help/faq.md` says
`config.patch` and `config.apply` *"hot-reload when possible and restart when required"*. Both are
descriptions of the apply, and neither is a claim about the next turn. Measured, the next turn is
unchanged.

**The RPCs are barely documented.** `channels.start` and `channels.stop` appear in the shipped docs
only in `docs/plugins/admin-http-rpc.md`'s list of methods an admin scope reaches — not in
`docs/gateway/protocol.md`, not in `docs/cli/channels.md`, and there is no `openclaw channels start`
subcommand. They are first-class methods with `operator.admin` in the runtime's own descriptor table
(`dist/core-descriptors-Cx0wrCGl.js`), reachable as `openclaw gateway call channels.stop --params
'{"channel":"telegram"}'`. That the surface is thin is a reason to pin it in a test, not a reason to
doubt it: it was called and it worked.

**The CLI's device pairing is minted from the first method it calls.** `openclaw gateway call`
requests the least-privilege scopes for the method being invoked, and the pairing record it creates
on first connect is approved at those scopes. A read-scoped first call (`config.get`) means the next
`config.patch` is refused at the socket with *"pairing required: device is asking for more scopes
than currently approved"*, and the CLI exits 1 having done nothing. This bit the measurement before
it was understood; a caller that starts with the admin method it actually wants never sees it.

## What was measured and what was only read

**Ran:** all four arms above, at the provider wire, each against its own gateway; the session-survival
check on the stop/start arm; `config.get`, `config.patch`, `config.apply`, `channels.stop`,
`channels.start` through `openclaw gateway call` against the fixture's loopback gateway and its
file-backed token.

**Read only:** the reload planner and the reload handler in `dist/`, which explain the results
rather than being the evidence for them; the drain difference between the reload path and the RPC
handlers; the runtime's docs, which were checked against the code wherever they said anything
load-bearing. **Not measured at all:** `secrets.reload`, which the code shows can restart channels
when a secret change demands it; `agents.update`, `agents.create`; `gateway.restart.request` and
`SIGUSR1`; and what a real Telegram deployment does with a message sent while the channel is stopped.

## What the pair does to a turn that is still in flight

The section above measured the pair on a quiet gateway. The stand down is not quiet: the Owner asks
for it in the System chat, and the lane monitor answers that turn's tool call — so the write and the
land are issued **while the turn that asked for them is still being answered**. If the pair drops
that turn, the Owner asks for a stand down and gets silence, which is a worse trade than the sessions
`--safe` spends.

Measured the same day and the same way, with the provider stub holding the answer open for 10 s
(`{ kind: "reply", text, afterMs: 10_000 }`) so the intervention lands mid-turn. Each arm stood its
own gateway, took one turn to warm the wire, then injected the slow turn, waited until the provider
had the request and had not answered, and intervened at that moment.

| Arm | The intervention | The in-flight answer |
|---|---|---|
| **nothing** (baseline) | — | arrived at **+10.7 s** |
| **`gateway restart --safe`** | exit 0, returned at +2.1 s: `safe restart requested; gateway will restart after active work drains` — `restart deferred: 2 queued or active operation(s); 1 pending reply delivery operation(s); 1 active embedded run(s)` | arrived at **+10.5 s** — baseline, no cost at all |
| **`channels.stop` + `channels.start`** | the stop took ~13.5 s and returned `{"stopped": false}`; the start returned `{"started": true}` | arrived at **+14.4 s** — late by the length of the stop, but it arrived |
| **the pair while a delegated run works** (front lane on `sessions_spawn`/`sessions_yield`, worker held 20 s) | pair issued once the worker chain was on the wire, returned at +14.6 s | arrived at **+22.1 s**, which is the worker's own 20 s — the embedded run was not dropped |

So the reply survives the pair. **What does not survive is the channel.**

### The stop does not stop, and the start that follows it does nothing

Under an in-flight turn the stop reports failure in its own payload — `"stopped": false` — and the
log says why: `[telegram] [default] channel stop exceeded 5000ms after abort; continuing shutdown`.
It keeps tearing down after it has answered. The `channels.start` issued a moment later then runs
against an account that still looks up, returns `{"started": true}`, and does nothing; the shutdown
then completes and leaves the channel down. **There is no second `starting provider` line in the
log.** The gateway is alive, the config is applied, and nothing is listening.

Measured, on the arm that wrote the chain change and then issued the pair mid-turn: the in-flight
answer arrived at +13.9 s as above, and then **three consecutive messages went unanswered**, with no
`Inbound message` line for any of them. That is the Owner's stand down landing into a chat that has
stopped replying.

It is recoverable and the landing is real. A **second** `channels.start`, issued after the shutdown
had finished, returned `{"started": true}`, brought the provider back, drained the backlog the stub
had queued, and the first turn after it ran **on the new model** — so the write had landed all along
and only the listener was missing.

### The verdict this forces

**The pair must not be issued from inside the turn that asked for it.** Either land after the reply
has gone out — where the stop returns `{"stopped": true}` and the change is live on the next turn,
which is what §1 measured — or keep starting until the channel is actually up rather than trusting
one `{"started": true}`. On this evidence `gateway restart --safe` is the better-behaved of the two
mid-turn: it is the only call here that knows a turn is in flight, says so, and waits.

### Ran, read, and not done

**Ran:** the four arms in the table, each on its own gateway, timed from the injection; the
landing-under-load arm and its recovery probe; the log inspection quoted above. Two other things
fell out of running them and are worth carrying: the CLI's default 10 s timeout **expires on a
`channels.stop` under load** — it reported `gateway timeout after 10000ms` and exit 1 while the
server completed the same call in 10 016 ms, so a caller needs `--timeout`; and the stub hands an
injected update to the first waiting long-poll, so the one the stopped provider left behind swallows
a message. The swallowed message is the harness. The three unanswered ones after it are not — they
produced no inbound line at all.

**Read, not measured:** that `waitForActiveWorkBeforeChannelReload` is absent from the RPC handlers,
which is the mechanism behind all of this.

**Not done:** the tool-call half of the question was approximated rather than met. No MCP server was
stood; the in-flight work in the fourth arm is a delegated worker run — an *embedded run*, which is
one of the two things the runtime's own drain logic counts, and it is what the deferral message
above names. A turn blocked on a real MCP tool call was not measured.

## The deferred land, as a bounded and verifiable sequence

Section 2 says the pair must not be issued from inside the turn that asked for it. That leaves a
sequence — write, let the reply go out, then reload the channel — and it is only buildable if two
things can be read from outside the gateway: **when nothing is in flight**, and **whether the channel
is actually up**. Both can. Measured 2026-08-24 against the same pinned `openclaw@2026.6.34`.

### The quiet signal: `gateway.restart.preflight`

Enumerated the same way as before — the descriptor table in `dist/core-descriptors-Cx0wrCGl.js`, the
method list in `docs/plugins/admin-http-rpc.md`, and `docs/gateway/`. One candidate reports active
work: `gateway.restart.preflight`. It is `operator.read`, takes **no params**, and mutates nothing —
`dist/restart-RWIx7SsR.js` shows `gateway.restart.request` and `gateway.restart.preflight` calling the
same `createSafeGatewayRestartPreflight()`, the preflight one without the schedule. Its counters are
the ones the channel reload waits on (`getTotalQueueSize`, `getTotalPendingReplies`,
`getActiveEmbeddedRunCount`, the task blockers), plus cron runs.

```
openclaw gateway call gateway.restart.preflight --params '{}'
```

Ran, on a quiet gateway and then with a turn held open by the provider stub:

| | payload |
|---|---|
| quiet | `{"safe":true,"counts":{"queueSize":0,"pendingReplies":0,"embeddedRuns":0,"cronRuns":0,"activeTasks":0,"totalActive":0},"blockers":[],"summary":"safe to restart now"}` |
| turn in flight | `{"safe":false,"counts":{"queueSize":2,"pendingReplies":1,"embeddedRuns":1,…,"totalActive":4},"blockers":[…],"summary":"restart deferred: 2 queued or active operation(s); 1 pending reply delivery operation(s); 1 active embedded run(s)"}` |

`safe` flipped back to `true` **1.6 s after the reply crossed the Telegram wire**, and that number
includes the CLI's own spawn. It is the same sentence `gateway restart --safe` printed in section 2,
available as a read. **The deferral does not have to be a timer.** Nothing in the shipped docs
mentions the method; it is read from the descriptor table and the handler, and then measured.

### The liveness check: `channels.status`, without `probe`

```
openclaw gateway call channels.status --params '{"channel":"telegram"}'
```

The answer lives at `channelAccounts.telegram[0]`. Ran, in all three states:

| state | what it says |
|---|---|
| healthy | `running: true, connected: true, lastError: null`, no `healthState` |
| wedged (section 2's failure) | `running: false, connected: false, healthState: "not-running", lastError: "channel stop timed out after 5000ms", lastStopAt` set — stable across four looks over 12 s |
| recovering | `running: true, connected: false` for the first few seconds, then `connected: true` |

So the wedge **is** reportable, and `channels.start`'s own `{"started": true}` is not the thing to
trust — it said exactly that while the channel was dead. The predicate that held is
`running === true && connected === true`.

**`probe: true` is not usable.** It timed out after 30 s — against a *healthy* channel as well as a
wedged one (`"probe timed out after 30000ms"`, `partial: true`). It discriminates nothing here and
costs 30 s a call.

**The recovery loop works and is short.** From the wedged state, one `channels.start` brought the
provider back (`running: true`), `connected` followed ~6 s later, and a turn was answered. One retry
was enough on the arm that measured it.

### The whole sequence, mid-turn, run twice

Hold a turn open (provider stub, 10 s); write the chain change; poll `gateway.restart.preflight`
until `safe`; `channels.stop`; then `channels.start` and poll `channels.status` until
`running && connected`, starting again if it is not.

| | run 1 | run 2 |
|---|---|---|
| the in-flight reply crossed the wire | +10.4 s | +11.9 s |
| `safe: true` | +12.0 s | +13.6 s |
| `channels.stop` | +13.7 s, **`{"stopped": true}`** | +15.3 s, **`{"stopped": true}`** |
| verified `running && connected` | +23.3 s (2nd status look) | +24.9 s (2nd status look) |
| the next turn's model | `ministral-3b-latest` | `ministral-3b-latest` |
| the prompt still carried a turn from before the land | yes | yes |

Every question comes out right: **the in-flight reply arrived** (it was never at risk — the stop had
not been issued yet), **the channel is verifiably up**, **the next turn used the new chain**, and
**the sessions survived**. The stop returns `{"stopped": true}` rather than section 2's
`{"stopped": false}`, because by then there is nothing to drain — which is the whole difference
between this sequence and the one that wedged.

Roughly **13 s from the reply going out to a verified-live channel**, most of it the two `connected`
polls; the RPCs themselves are sub-second and the cost here is one CLI process per call.

### Verdict, and what to do when the verify never comes good

**The deferred land is buildable as a bounded, verifiable sequence**, with no timer and no guessing:

1. write the generated configuration;
2. poll `gateway.restart.preflight` until `safe === true` — bounded, and it is the runtime's own
   drain condition rather than an approximation of it;
3. `channels.stop` with `--timeout` well above the CLI's 10 s default (a loaded stop took 10 016 ms
   and the default timeout reports failure for a call the server completed);
4. `channels.start`, then poll `channels.status` until
   `channelAccounts.<channel>[0].running && .connected`, re-issuing `channels.start` when `running`
   is false;
5. **when the bound is spent and the verify has not come good, fall through to
   `openclaw gateway restart --safe`.** A restart costs the sessions this sequence exists to save,
   but it is the only call measured here that always ends with a live channel — and a stand down that
   leaves the Owner's chat unable to answer is a worse outcome than one that drops a session. The
   same fall-through covers step 2 timing out: `--safe` defers to the same counters itself, so it is
   safe to issue while a turn is still in flight, which is precisely what section 2 measured.

### Ran, read, and not done

**Ran:** every payload quoted above, through `openclaw gateway call` against the fixture's loopback
gateway; the preflight in both states and the delay between the reply and `safe`; `channels.status`
in the healthy, wedged and recovering states, with and without `probe`; the recovery loop; and the
full sequence twice on its own gateway each time. The `--timeout` figure is carried from section 2's
own run.

**Read, not measured:** that `gateway.restart.preflight` and `gateway.restart.request` share
`createSafeGatewayRestartPreflight`, and that its counters are the reload's; the scopes in the
descriptor table.

**Worth carrying, and it bit this measurement too:** the CLI mints its pairing record from the
least-privilege scopes of the **first** method it calls. A run whose first call was `channels.status`
had every later `channels.stop` refused with *pairing required*, and looked for a while like a
channel that would not stop. Make the first call an admin one.
