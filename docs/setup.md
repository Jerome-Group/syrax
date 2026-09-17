# Setup

One bot carrying the four chats — **General**, **Academic**, **Media** and **System** — with the
front lane answering each of them and delegating the slow work to the worker lane. The tracked adapter includes worker delegation, search, the lane monitor and the academic desk.
This guide describes that configuration; a clean live-account acceptance run is tracked separately
in [#132](https://github.com/Jerome-Group/syrax/issues/132).

Everything Syrax stores lives outside this checkout. The repository holds the pin, the adapter that
generates the runtime's configuration, and the tests — nothing a `git add` could turn into a public
commit.

## Before you start

This is the Owner's **macOS, single-user Telegram** setup. The supplied service installers use
LaunchAgents, macOS `stat` and `pmset`; Linux and Windows service installation are not supplied.
Use a dedicated bot and private state root, rather than replacing an existing OpenClaw installation.
LaunchAgents run in your logged-in user's session. Set the Mac's timezone to the timezone you want
for the morning brief and schedules; keeping the machine awake and logged in is part of operating it.

Prepare these first:

- Git, **Node.js 26 or newer** and npm; **Python 3.14** for search. The wrappers use Node from
  `/opt/homebrew/bin`, `/usr/local/bin` or the system PATH they set, not your shell's version-manager
  initialization. Verify that a supported Node is available there before loading a service.
- Your own **Gemini, Mistral, Groq and Z.AI developer API keys**, a Telegram bot token and a locally
  generated gateway token. [Providers and credentials](providers.md) gives the official account
  links, exact JSON template and commands. API quotas and any charges belong to your accounts.
- A document directory to index, with an academic subdirectory for `searchScopes.academic`.
  The pinned search model takes approximately 698 MB before the environment and index; allow
  additional disk space for your document corpus and private logs.
- The separately configured [academic-os](https://github.com/Jerome-Group/academic-os) and
  [ntulearn](https://github.com/Jerome-Group/ntulearn) products. Follow each repository's setup first:
  academic-os needs its calendar configuration and built CLI; ntulearn needs your own working
  authenticated session. Syrax does not supply those accounts or log you in.

**The academic pair is currently required by the configuration generator.** Its six path fields
and `searchScopes.academic` cannot simply be omitted to get a chatbot-only install. If you cannot
use those integrations, reproducing the complete setup requires adapting the agent/tool wiring in
source; that reduced deployment is not a supported setup option yet. The Media topic can answer
chat messages, but the full Media capability is separate unfinished work
([#131](https://github.com/Jerome-Group/syrax/issues/131)).

## Clone and choose private paths

Run the following in a terminal. The checkout may live wherever you keep source; the private root
must be **outside it**. The commands below are for a new installation, and every later command is
run from the repository root in the same shell.

```sh
git clone https://github.com/Jerome-Group/syrax.git
cd syrax
npm ci

umask 077
export SYRAX_PRIVATE="$HOME/.local/share/syrax"
export RUNTIME_ROOT="$SYRAX_PRIVATE/runtime"
export SEARCH_ROOT="$SYRAX_PRIVATE/search-env"
export DEPLOYMENT="$SYRAX_PRIVATE/deployment.json"
export GENERATED_CONFIG="$SYRAX_PRIVATE/openclaw.json"
export STATE_DIR="$SYRAX_PRIVATE/runtime-state"
mkdir -p "$RUNTIME_ROOT" "$SYRAX_PRIVATE/secrets"
chmod 700 "$SYRAX_PRIVATE" "$SYRAX_PRIVATE/secrets"
cp -n config/deployment.example.json "$DEPLOYMENT"
```

These environment variables hold paths only. Re-establish them if you open another shell.
The shell variables do not configure Syrax by themselves: edit the deployment JSON to match them.

## Safe setup sequence


1. Read [system-overview.md](system-overview.md) and [configuration.md](configuration.md).
2. **Install the pinned runtime outside the checkout.** The lockfile is the pin
   ([ADR-0003](adr/0003-the-runtime-adapter-wraps-openclaw.md)), so the install comes from the
   tracked one and never resolves afresh:

   ```sh
   cp runtime/package.json runtime/package-lock.json "$RUNTIME_ROOT/"
   (cd "$RUNTIME_ROOT" && npm ci)
   ```

3. **Write the secrets store.** Follow [Providers and credentials](providers.md#create-the-secrets-store)
   to fill the private copy of `config/secrets.example.json`, generate the gateway token and check
   all six values without printing them. Keep it mode `600` in a `700` directory.
4. **Describe the machine.** Edit the private deployment copied above. Use absolute paths,
   not shell variables or `~`. [Deployment fields](#deployment-fields) below maps every field to
   what you must provide. Complete [Telegram preparation](#telegram-preparation) below and set
   `ownerTelegramUserId` to your numeric user ID before continuing.
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

8. **Stand up the search unit.** Its environment is created outside the checkout and installed
   from the transitive pin, and the package is installed from the checkout so the code that runs is
   the code that is tracked. The export is fetched **once, deliberately**: nothing in the index or
   query path reaches a network, and an unattended start refuses rather than downloading.

   ```sh
   python3.14 -m venv "$SEARCH_ROOT"
   "$SEARCH_ROOT/bin/pip" install -r search/requirements.txt
   "$SEARCH_ROOT/bin/pip" install --no-deps -e ./search
   "$SEARCH_ROOT/bin/python" -m syrax_search fetch-embedder "$DEPLOYMENT"

   node src/cli/install-search-agent.ts "$DEPLOYMENT"
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jerome-group.syrax.search.plist
   ```

   The installer also prints bootstrap commands for `index-incremental` and `index-full`.
   Run both printed commands to enable the recurring index passes. To index immediately instead
   of waiting for a schedule, poke the running search unit (use your `searchPort` if changed):

   ```sh
   curl --fail -X POST http://127.0.0.1:18790/index/full
   ```

9. **Stand up the lane monitor.** It is the third unit, and the one that holds what the runtime
   does not: the rationed lane's counters, and the escape hatch that refuses before it spends.

   ```sh
   node src/cli/install-monitor-agent.ts "$DEPLOYMENT"
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jerome-group.syrax.hatch.plist
   ```

   Also run the installer's printed bootstrap commands for `rung-watch`, `rung-sweep` and
   `retrieval-report`. The daily rung sweep makes real provider requests, so it consumes quota.
   The other two schedules inspect local state and can post reports into System.

   What its wrapper runs is this checkout, so move or rename the checkout and run the installer
   again. Its pre-flight **refuses to start** when the counters' directory cannot be made private,
   and when the secrets store is missing or the machine has left it readable.

10. **Stand up the academic desk.** It is the fourth unit: the academic pair's tools, and the 07:00
    brief. Both academic products must already be on the machine and working — `academic-os` built
    (`npm ci && npm run build`, so `dist/src/cli.js` exists) with its calendars set up, and
    `ntulearn` configured with a live saved session. Syrax holds no credential of either.

    ```sh
    node src/cli/install-academic-agent.ts "$DEPLOYMENT"
    launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jerome-group.syrax.academic.plist
    launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jerome-group.syrax.brief.plist
    ```

    The second plist is the brief's schedule, and it is the only thing that posts into Academic
    unasked. Its pre-flight **refuses to start** on a scratch it cannot make private or a readable
    secrets store, and **warns and proceeds** on a product that is not there — the brief still goes
    out, and it says what did not run.

11. Before committing a change, inspect the staged file list and search it for credentials, private
    conversations, machine-specific paths, and provider responses.

## Deployment fields

Keep the example's JSON structure and edit its values. For the private root above, replace
`/absolute/path/outside/this/repository` with the **expanded absolute path** printed by
`printf '%s\n' "$SYRAX_PRIVATE"`, then adjust the following. Do not apply that replacement to a
live file from another installation.

| Fields | Values to supply |
|--------|------------------|
| `runtimeRoot`, `configPath`, `stateDir` | Match `RUNTIME_ROOT`, `GENERATED_CONFIG`, `STATE_DIR` above |
| `workspace`, `logsDir`, `secretsStore` | Private `workspace`, `logs`, `secrets/syrax.json` below your private root |
| `carrierMap` | Private `runtime-state/carriers.json`; created by provisioning, retained across upgrades |
| `wrapperPath`, `searchWrapperPath`, `monitorWrapperPath`, `academicWrapperPath` | The example's four `bin/start-*.sh` paths under your private root; installers create them |
| `searchRoot`, `searchIndex`, `monitorState` | Private `search-env`, `search-index`, `lane-monitor`; `searchRoot` must match `SEARCH_ROOT` |
| `academicOsRoot`, `ntulearnRoot` | Actual checkouts of those two products, outside the Syrax checkout |
| `academicOsConfig`, `academicOsState` | academic-os's existing configuration file and configured state root |
| `ntulearnState` | ntulearn's configured state-file parent, holding its output; use that product's actual location |
| `academicState` | Syrax's own private academic-desk scratch directory |
| `indexAllowlist` | Nonempty list of document roots to crawl |
| `extractionScope` | Nonempty list of roots or patterns within the allowlist whose contents may be extracted |
| `blocklist` | Nonempty list of forbidden roots; include your entire Syrax private root and the other products' credential/state roots |
| `searchScopes.academic` | Your academic document root, inside an `indexAllowlist` root; required by the current agents |
| `ownerTelegramUserId` | Your positive numeric Telegram user ID, not a username, bot ID or group ID |

The default local ports are gateway `18789`, search `18790`, monitor `18791`, academic `18792`.
If occupied, set `gatewayPort`, `searchPort`, `monitorPort`, `academicPort` explicitly in the
private JSON and adjust manual curl commands. Keep provider URLs at their defaults for a normal
install. The illustrative `syrax.example.toml` is not an input file and does not need to be copied.

## Telegram preparation

1. Create a dedicated bot using [BotFather](https://core.telegram.org/bots/features#botfather)
   and place its token in the secrets store. Enable
   [topics in private chats](https://core.telegram.org/bots/features#topics-in-private-chats)
   for that bot in BotFather.
2. Open the bot's private chat from the account that will own Syrax and send `/start`. This is a
   private chat with topics, not a forum group. Syrax provisions the four topics itself.
3. Obtain your numeric user ID from the bot's incoming update. Before starting the gateway, with
   no other process polling this dedicated bot, the snippet below prints only sender IDs. It also
   checks that topics are enabled and no webhook is configured. If no ID appears, send a fresh
   private message to the bot and repeat. Choose your own ID if more than one appears.

```sh
node --input-type=module - "$SYRAX_PRIVATE/secrets/syrax.json" <<'JS'
import { readSecret, secretPaths } from './src/adapter/secrets-store.ts';
const token = readSecret(process.argv[2], secretPaths.telegramBotToken);
async function call(method) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', signal: AbortSignal.timeout(15000)
  }).catch(() => { throw new Error('Telegram transport failed; check connectivity.'); });
  const body = await response.json();
  if (!body.ok) throw new Error(`Telegram ${method} failed (HTTP ${response.status}).`);
  return body.result;
}
if (!(await call('getMe')).has_topics_enabled) {
  throw new Error('Enable private-chat topics in BotFather first.');
}
if ((await call('getWebhookInfo')).url) {
  throw new Error('This bot has a webhook; use a dedicated polling bot.');
}
const updates = await call('getUpdates');
const ids = updates.filter(u => u.message?.chat.type === 'private')
  .map(u => u.message.from.id);
console.log('Private-message sender IDs:', [...new Set(ids)]);
JS
```

This reads Telegram but sends no messages and prints no token or message text. Stop using
`getUpdates` once the gateway starts: two pollers compete. Put the chosen ID in the deployment,
then return to step 5. See Telegram's [getUpdates](https://core.telegram.org/bots/api#getupdates)
and [getMe](https://core.telegram.org/bots/api#getme) references for those API checks.

## Verify the installation

A generated config is not proof of a working account. After loading the services:

```sh
launchctl print gui/$(id -u)/com.jerome-group.syrax.gateway
launchctl print gui/$(id -u)/com.jerome-group.syrax.search
launchctl print gui/$(id -u)/com.jerome-group.syrax.hatch
launchctl print gui/$(id -u)/com.jerome-group.syrax.academic
```

Check that each resident process stays running, rather than repeatedly exiting. Inspect private
`logsDir` files when it does not. In your bot, send a short greeting in each of General, Academic,
Media and System. Then test a known indexed document in General, an academic read in Academic,
and a current lane-usage report in System. These live chat checks consume provider quota; test the
hatch only if you intend to spend its allowance. A successful greeting alone does not prove search,
academic access or every model fallback.

| Symptom | What to check |
|---------|---------------|
| Generator refuses a path or scope | All private paths must be outside the checkout; all six academic fields and `searchScopes.academic` must be present |
| Secrets permission failure | `chmod 700` the store's parent and `chmod 600` the file; run the nonprinting check in the credentials guide |
| Credential ref unresolved / provider rejects auth | Exact JSON property names, no placeholders, valid key for the selected endpoint; regeneration alone cannot fix account permissions |
| `429` or unavailable model | Account quota and model access; use System's lane report; a configured name is not an entitlement |
| Bot does not answer | Correct owner ID, `/start` sent, topics enabled, no webhook or competing poller, gateway running |
| Search refuses to start | Python environment and deliberate `fetch-embedder` completed; valid allowlist/scope/blocklist; index directory readable by the service user |
| Search finds nothing | Complete a full index pass; confirm the document is within extraction scope and outside the blocklist |
| Academic tools report missing products | Verify the other products work using their own setup instructions, paths, build and authenticated state |
| Works in terminal, fails under launchd | Supported Node in the wrapper's PATH, private paths accessible, external volumes mounted, capture logs checked |

## Updates, restarts and backups

After changing the deployment or adapter, regenerate configuration. If paths or wrappers changed,
unload the affected jobs, rerun their installers, then load the printed plists. For a loaded service
whose wrapper path is unchanged, restart with:

```sh
launchctl kickstart -k gui/$(id -u)/com.jerome-group.syrax.gateway
```

Use the corresponding label for search, hatch or academic. A standing-instruction change also
needs `/new` in each affected chat before evaluating its behavior. Runtime upgrades come from a
reviewed change to `runtime/package-lock.json`; recopy both runtime manifests and run `(cd "$RUNTIME_ROOT" && npm ci)` with the gateway stopped, then restart it. Do not upgrade a global
OpenClaw binary and assume this install changed.

Back up the private deployment, secrets store, runtime state (especially **`carrierMap`**), workspace,
lane-monitor state and search benchmark with a private backup system. Stop services for a consistent
snapshot. The carrier map binds logical chats to Telegram topic IDs: losing it leaves existing topics
unmapped, and rerunning provisioning creates new topics instead of discovering them by name. Restore
the map with the matching bot/account; do not delete it as a routine reset. Losing the monitor state
also loses consumed-allowance counts and model stand-down/removal decisions. The search index can be
rebuilt from documents, but the benchmark and its historical results cannot be recreated that way.

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

To run it without launchd, first unload the gateway job and invoke the generated wrapper
(`wrapperPath` in the deployment):

```sh
launchctl bootout gui/$(id -u)/com.jerome-group.syrax.gateway
"$SYRAX_PRIVATE/bin/start-gateway.sh"
```

If the job was never loaded, skip `bootout`. The wrapper retains the private-mode and credential
pre-flight checks; its diagnostics go to `logsDir/gateway.err.log`, so follow that file in a second
terminal. Stop the foreground process with Ctrl-C before bootstrapping the job again.

Only one gateway can hold port 18789, and a foreground one keeps the supervised one down without
saying so — the runtime exits `0` on a taken port, which is not a failure `KeepAlive` retries.

## Proving it without a private account

```sh
SYRAX_RUNTIME_ROOT="$RUNTIME_ROOT" npm test
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
