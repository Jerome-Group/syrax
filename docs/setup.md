# Setup

One bot carrying the four chats — **General**, **Academic**, **Media** and **System** — with the
front lane answering each of them. The worker lane and the capability tool layers are later work,
so what follows stops where the system does rather than describing one that is not standing yet.

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

6. **Create the four chats.** Each is a topic in the bot's own private chat, created by name; the
   provisioning map records which topic carries which chat, and it is private runtime state like
   everything else it sits beside. Run it again whenever you want: it creates only what the map
   does not already name, and it posts nothing.

   ```sh
   node src/cli/provision-chats.ts "$DEPLOYMENT"
   ```

   Nothing here ever matches a chat to a topic by the topic's **name**
   ([ADR-0013](adr/0013-a-chats-existence-is-syraxs-not-the-owners-furniture.md)) — the name is
   what a recreation reuses, and the id is what routes.

7. **Write the wrapper and the LaunchAgent**, then load it. Nothing is loaded for you: the files
   are written, and starting the job is your command.

   ```sh
   node src/cli/install-gateway-agent.ts "$DEPLOYMENT"
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jerome-group.syrax.gateway.plist
   ```

   The wrapper is what runs, never the runtime binary directly. It sets the `PATH` a supervisor does
   not provide, opens the capture, and runs the pre-flight — which **refuses to start** on a
   credential ref the runtime cannot resolve or a scratch directory the machine has left readable,
   and **warns and proceeds** on a posture finding. `KeepAlive` brings the gateway back from a
   crash; `launchctl bootout gui/$(id -u)/com.jerome-group.syrax.gateway` stops it.

8. Before committing a change, inspect the staged file list and search it for credentials, private
   conversations, machine-specific paths, and provider responses.

## When a chat comes back empty

Clearing a topic in the Telegram client is a **view** operation: the chat is the system's shape, not
your furniture, and Syrax is not told the topic went away. The next message Syrax writes into it
fails, and that failure is the only discovery there is — so the write path creates the topic again,
writes the new id into the map, regenerates the configuration so the new carrier still routes to its
own agent, and sends what it was sending. A **resurrection** — the topic returning with its messages
and its id intact — is invisible to Syrax and is not announced. A **recreation** is: it arrives in
the System chat, naming the new carrier id.

The running gateway picks the new carrier up by itself, and no restart is part of this: a `channels`
write is landed by a channel reload, which the runtime defers only until the turns in flight drain
([ADR-0021](adr/0021-a-config-write-is-applied-when-it-is-written-and-landed-when-a-channel-reloads.md)).
The **first** message typed in the recreated chat can still meet the old routing and be answered as
General — ADR-0013's standing rule for an unrecognised thread id — and the one after it lands on the
chat's own agent. That is what the announcement says, and it is the whole of the delay.


One recreation has a stage of its own, because two systems hold the Media chat's carrier id and only
one of them knows it changed:

- **Re-point Seerr after a Media recreation.** This is a stage of the provisioning wizard, which is
  to say it is yours and never a push from Syrax: the capability's own product owns its
  configuration. Seerr posts availability into the Media topic on Syrax's own bot token, from an id
  in Seerr's own configuration, so a recreated Media chat leaves it writing into a dead thread — and
  its `400` is invisible here. Take the new carrier id from the System announcement and set it in
  Seerr.

Running it in the foreground is still the way to watch a start closely:

```sh
OPENCLAW_CONFIG_PATH="$GENERATED_CONFIG" OPENCLAW_STATE_DIR="$STATE_DIR" \
  node "$RUNTIME_ROOT/node_modules/openclaw/openclaw.mjs" gateway
```

Only one gateway can hold port 18789, and a foreground one keeps the supervised one down without
saying so — the runtime exits `0` on a taken port, which is not a failure `KeepAlive` retries.

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
| the install, start, test, and stop commands | steps 2 and 7, and the section above; `launchctl bootstrap` and `bootout`, or a signal to the foreground process |
| where secrets are read from | one JSON store, by file-backed ref, refused at an insecure mode |
| which tools are enabled by default | `tools.profile: "minimal"`, and both skills catalogues off |
| where state is written and how it is kept outside this repository | `stateDir` and `workspace` in the deployment; the generator refuses either inside the checkout |
| how a clean test run proves the adapter works without a private account | the two stubs above |
