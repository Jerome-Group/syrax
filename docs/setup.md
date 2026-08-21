# Setup

This is the walking skeleton: one bot, one **General** chat, and the front lane answering it. The
four chats, the worker lane and the capability tool layers are later work, so what follows stops
where the skeleton does rather than describing a system that is not standing yet.

Everything Syrax stores lives outside this checkout. The repository holds the pin, the adapter that
generates the runtime's configuration, and the tests — nothing a `git add` could turn into a public
commit.

## Safe setup sequence

1. Read [system-overview.md](system-overview.md) and [configuration.md](configuration.md).
2. **Install the pinned runtime outside the checkout.** The lockfile is the pin
   ([ADR-0003](adr/0003-the-runtime-adapter-wraps-openclaw.md)), so the install comes from the
   tracked one and never resolves afresh:

   ```sh
   cp runtime/package.json runtime/package-lock.json "$RUNTIME_ROOT/"
   npm ci --prefix "$RUNTIME_ROOT"
   ```

3. **Write the secrets store.** One JSON file, mode `600` inside a `700` directory
   ([ADR-0010](adr/0010-one-secrets-store-reached-by-file-backed-refs.md)). It holds the provider
   keys, the bot token and the gateway auth token; nothing else on the machine holds any of them,
   and no key is ever exported into an environment.
4. **Describe the machine.** Copy
   [`config/deployment.example.json`](../config/deployment.example.json) outside the repository and
   replace every path and the Owner's Telegram user ID.
5. **Generate the runtime configuration.**

   ```sh
   node src/cli/generate-config.ts "$DEPLOYMENT"
   ```

   It refuses before it writes: on a secrets store the machine has left readable, and on any root
   inside the checkout.

6. **Start the gateway** against what was generated, with no credential in its environment:

   ```sh
   OPENCLAW_CONFIG_PATH="$GENERATED_CONFIG" OPENCLAW_STATE_DIR="$STATE_DIR" \
     node "$RUNTIME_ROOT/node_modules/openclaw/openclaw.mjs" gateway
   ```

7. Before committing a change, inspect the staged file list and search it for credentials, private
   conversations, machine-specific paths, and provider responses.

Supervising this as a LaunchAgent, and the pre-flight that refuses to start rather than start
wrong, is a later ticket. Until then it is a foreground process.

## Proving it without a private account

```sh
npm test
```

The suite drives the pinned gateway through two local stubs — a Telegram Bot API stub it long-polls
and an OpenAI-compatible provider stub — so a clean run proves the reply path with no external call
and no quota spent. Point `SYRAX_RUNTIME_ROOT` at the install from step 2; the gateway-backed tests
skip without it, which is why CI's green tick is about this repository's artefact and the suite that
matters runs on the mini.

## Runtime adapter checklist

An adapter is ready for a setup guide only when it can state:

| Question | This adapter's answer |
|----------|-----------------------|
| the exact runtime and version | `openclaw@2026.6.34`, pinned in `runtime/package-lock.json` |
| the install, start, test, and stop commands | steps 2 and 6, and the section above; stopping is a signal to the foreground process until supervision lands |
| where secrets are read from | one JSON store, by file-backed ref, refused at an insecure mode |
| which tools are enabled by default | `tools.profile: "minimal"`, and both skills catalogues off |
| where state is written and how it is kept outside this repository | `stateDir` and `workspace` in the deployment; the generator refuses either inside the checkout |
| how a clean test run proves the adapter works without a private account | the two stubs above |
