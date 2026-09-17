# Providers and credentials

Cloning Syrax gives you the Owner's provider configuration, not access to the Owner's accounts.
Use your own keys for all four providers to reproduce the default setup. The same provider key
serves that provider's models across lanes; you do not create one key per model.

Start with [setup.md](setup.md) for the machine prerequisites and private directory layout. This
page is the credential step in that sequence. No OpenAI account is required by the default chains:
**OpenAI-compatible** describes the HTTP request format, not who supplies or bills the model.

## About the original setup wizards

The Owner's original `provision-providers.sh` and `provision-telegram.sh` are machine-local
scripts, not files shipped by this repository. Those older copies write `providers.env` and
`telegram.env`; the current adapter uses the JSON store below instead. They also describe an older
provider set. A clone does not include a credential-entry wizard. Follow this page to provision the
current contract, rather than looking for those scripts or using OpenClaw's interactive secrets
migration commands (see [ADR-0010](adr/0010-one-secrets-store-reached-by-file-backed-refs.md)).

## Accounts to prepare

Create a key in each provider's developer console, using the official instructions below. Check
that your account can use the models configured in this checkout before depending on a fallback.

| Provider | Where to create your key | Field in the private secrets JSON | Used by |
|----------|--------------------------|----------------------------------|---------|
| Google Gemini | [Google AI Studio key instructions](https://ai.google.dev/gemini-api/docs/api-key) | `providers.gemini.apiKey` | Front, worker and hatch |
| Mistral | [Activate Studio and generate an API key](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key) | `providers.mistral.apiKey` | Front and worker |
| Groq | [Groq developer quickstart](https://console.groq.com/docs/quickstart) | `providers.groq.apiKey` | Front and worker |
| Z.AI | [Open Platform quickstart](https://docs.z.ai/guides/overview/quick-start) | `providers.zai.apiKey` | Worker fallback |

Z.AI uses the **general API** at `https://api.z.ai/api/paas/v4`, not the Coding Plan endpoint.
Choose credentials with access to that API. Provider tutorials may show environment variables;
Syrax instead reads all four keys from the file below.

These accounts' actual model access, rate limits and billing apply. The repository's free-tier
choices and measured limits are not a promise that a new account gets the same allowance. Adding
billing does not change Syrax's local hatch counters. A missing key is not a supported way to disable
a provider: the generated configuration still references it and startup audits those references.

## Create the secrets store

The following uses `SYRAX_PRIVATE` from the setup guide. Run from the cloned repository. **For a
new installation only**: do not copy the example over an existing store.

```sh
umask 077
mkdir -p "$SYRAX_PRIVATE/secrets"
chmod 700 "$SYRAX_PRIVATE/secrets"
cp -n config/secrets.example.json "$SYRAX_PRIVATE/secrets/syrax.json"
chmod 600 "$SYRAX_PRIVATE/secrets/syrax.json"
```

Open that private copy in a local editor and replace the four API-key placeholders and the bot-token
placeholder. The exact JSON structure is in
[`config/secrets.example.json`](../config/secrets.example.json); preserve its property names.
Never edit the tracked example to hold a real value. Keys belong in this store, not in
`deployment.json`, the illustrative TOML, shell startup files or the generated OpenClaw config.

`channels.telegram.botToken` comes from creating your own bot with
[BotFather](https://core.telegram.org/bots/features#botfather). `gateway.authToken` is different:
it protects your local OpenClaw gateway and is a random secret you generate yourself. This command
fills only an untouched gateway placeholder, without printing the token or passing it as a shell
argument:

```sh
node --input-type=module - "$SYRAX_PRIVATE/secrets/syrax.json" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const path = process.argv[2];
const store = JSON.parse(readFileSync(path, 'utf8'));
if (store.gateway.authToken !== '<generate-a-private-random-token>') {
  throw new Error('Gateway token already set; leaving the store unchanged.');
}
store.gateway.authToken = randomBytes(32).toString('hex');
writeFileSync(path, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
JS
```

Set `secretsStore` in your private deployment file to the **absolute path** of this store. JSON
paths do not expand `~`, `$HOME` or `$SYRAX_PRIVATE`.

To check its structure and permissions without printing any credential or contacting a provider:

```sh
node --input-type=module - "$SYRAX_PRIVATE/secrets/syrax.json" <<'JS'
import { readSecret, secretPaths } from './src/adapter/secrets-store.ts';
for (const [name, pointer] of Object.entries(secretPaths)) {
  const value = readSecret(process.argv[2], pointer);
  if (value.startsWith('<')) throw new Error(`Replace the ${name} placeholder.`);
}
console.log('All six secrets present; store and parent permissions accepted.');
JS
```

This does not prove a key is valid or has model access. A real conversation tests the selected
provider; one successful reply does not test every fallback. Never paste the store or private logs
into an issue to diagnose a rejected key.

## Which model answers

These are the selections in the tracked lane files, not a current provider catalogue. Within a
front or worker chain, OpenClaw selects the primary and handles fallbacks; a request is not sent to
all providers at once.

| Lane | Configured model order | Purpose |
|------|------------------------|---------|
| Front | Gemini `gemini-3.5-flash-lite` → Mistral `ministral-3b-latest` → Groq `openai/gpt-oss-120b` | Owns the conversation |
| Worker | Gemini `gemini-3.1-flash-lite` → Mistral `ministral-8b-latest` → Groq `openai/gpt-oss-20b` → Z.AI `glm-4.5-flash` | Delegated work |
| Hatch | Gemini `gemini-3.7-flash` → `gemini-3.6-flash` → `gemini-3.5-flash` → `gemini-3-flash-preview` | Explicitly requested calls, counted locally at 20 requests per model per day |

The hatch is a separate tool owned by the lane monitor, not the automatic final fallback. It selects
an available allowance and makes a direct API call. Its counters survive restarts in `monitorState`.
There can also be background model usage: the runtime heartbeat and the monitor's scheduled model
sweep are described in [configuration.md](configuration.md). An idle chat does not imply zero calls.

Search embeddings are separate from these hosted LLMs: the search unit downloads a pinned ONNX
model once and runs it locally. No fifth provider API key is needed for search.

## Where the configuration lives

| File | What you change or inspect |
|------|---------------------------|
| Private `deployment.json` | Machine paths, account ID and optional endpoint overrides |
| Private `secrets/syrax.json` | Your credentials |
| [`src/adapter/front-lane.ts`](../src/adapter/front-lane.ts), [`worker-lane.ts`](../src/adapter/worker-lane.ts), [`hatch-lane.ts`](../src/adapter/hatch-lane.ts) | Model choices, order and model-specific limits |
| [`src/adapter/deployment.ts`](../src/adapter/deployment.ts) | Default provider URLs |
| [`src/adapter/providers.ts`](../src/adapter/providers.ts) | Runtime provider blocks and key references |
| [`src/adapter/secrets-store.ts`](../src/adapter/secrets-store.ts) | Secret names and permission rules |
| [`src/adapter/instruction.ts`](../src/adapter/instruction.ts) | Standing instructions for each chat |
| [`src/monitor/hatch.ts`](../src/monitor/hatch.ts) | The hatch's direct API call |

The generated `openclaw.json` contains a reference such as
`{"source":"file","provider":"syrax","id":"/providers/gemini/apiKey"}`, not the key. OpenClaw
resolves it from the store; Syrax's monitor resolves the same store for its own calls.

To use fewer providers or different models, adapt the lane definitions and the related provider,
quota and telemetry assumptions in your fork. There is no single-provider setup switch. Endpoint
overrides in `providerBaseUrls` retain the existing provider IDs and model selections; pointing a
URL at a different service is not enough to add a new provider. The `[model]` example in
`syrax.example.toml` is illustrative and is not read by the generator.

After an adapter or deployment edit, regenerate with `node src/cli/generate-config.ts "$DEPLOYMENT"`
and restart the affected units as described in setup. After key rotation, retain the same JSON
shape and permissions and restart the gateway and lane monitor; restart the academic desk as well
when changing the bot token. After a standing-instruction change, start a fresh `/new` session in
each affected chat before judging it: an existing session retains its earlier context.
