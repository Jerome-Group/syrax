# Prototype: can a plugin hook hush the model-fallback notice?

Throwaway code answering one question from [#123](https://github.com/Jerome-Group/syrax/issues/123):
the two things the ticket asked for that no *configuration* of `openclaw@2026.6.34` reaches — a
progress draft reduced to a finished line, and a fast-path death that restarts silently — are they
reachable through the runtime's **plugin hooks** instead?

Not merged, and not to be copied into `src/`: loading a plugin is in-process code on the reply path,
which is what [ADR-0003](../docs/adr/0003-the-runtime-adapter-wraps-openclaw.md) forswore. What
lands on the default branch is the finding, in
[ADR-0022](../docs/adr/0022-the-delegating-turn-wears-the-runtimes-surface.md).

## What was measured

Both spikes stand the ordinary test harness — the Telegram stub, the provider stub, the generated
configuration — and then patch `plugins.load.paths` into the generated file before the gateway is
spawned.

```sh
SYRAX_RUNTIME_ROOT=/path/to/runtime node prototype/spike-hooks.ts       prototype/hush-plugin/index.mjs
SYRAX_RUNTIME_ROOT=/path/to/runtime node prototype/spike-hooks-draft.ts prototype/hush-plugin/index.mjs
```

**The notice can be cancelled.** `reply_payload_sending` sees the fallback notice as a payload
carrying `isFallbackNotice: true`, and returning `{ cancel: true }` stops it: the silent rung is
still abandoned on the idle clock, the chain still advances, and the only thing that reaches the
chat is the answer from the next rung. Measured, with the notice present in the same scenario when
the plugin is not loaded.

**The draft cannot be reached.** On a delegating turn the draft's whole life — `sendMessage`, two
`editMessageText`, `deleteMessage` — crosses **no hook at all**. Only the final answer passes
through `message_sending` / `message_sent`. A plugin could prepend a line to the answer's text or
post its own message after it; neither is the draft reduced to a finished line.

## The trap that cost the first run

`plugins.load.paths` must name the **entry file**, not the plugin directory. Pointed at the
directory, the gateway starts, logs its usual nine bundled plugins, reports no error of any kind —
and the hook simply never fires. The log line to check is the plugin count in
`http server listening (N plugins: …)`.
