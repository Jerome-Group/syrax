# System overview

Syrax is a personal chatbot system, not a single prompt. Its public contract separates the parts
that explain the system from the state that only exists while the Owner runs it.

~~~mermaid
flowchart LR
    input["User input"] --> interface["Interface"]
    interface --> orchestrator["Agent orchestration"]
    orchestrator --> tools["Allowlisted tools"]
    orchestrator --> context["Context and memory"]
    orchestrator --> model["Model provider"]
    tools --> external["External services"]
    model --> response["Response"]
    context -. "private runtime state" .- boundary["Private boundary"]
~~~

The runtime behind orchestration is OpenClaw, pinned to an exact version
([ADR-0003](adr/0003-the-runtime-adapter-wraps-openclaw.md)). The adapter connecting this contract
to it is configuration rather than a layer of code on the request path: `src/adapter/` generates the
runtime's own configuration file, and exits
([ADR-0019](adr/0019-the-configuration-contract-is-generated-and-the-generator-runs-before-the-gateway.md)).

Syrax's own proactive writes do not travel that path. `src/surface/` sends them to the Bot API
directly, because the failure is the point: a send into a cleared carrier is the only report the
platform ever makes of one, and it only stays legible if Telegram's own description arrives intact
([ADR-0013](adr/0013-a-chats-existence-is-syraxs-not-the-owners-furniture.md)).

## Components

| Component | Public contract | Private material |
|-----------|-----------------|------------------|
| Interface | Input/output shape and transport assumptions | User messages and account sessions |
| Agent orchestration | Routing, tool policy, context assembly, and response handling | Per-run state and private prompts |
| Tools | Explicit capabilities and permission boundaries | Service credentials and returned private data |
| Context and memory | Storage interface and retention policy | Conversations, embeddings, and memory records |
| Model provider | Provider adapter interface and model-selection rules | API keys, requests, responses, and provider metadata |
| Observability | Sanitisation and failure-reporting rules | Local logs and traces, when they contain private data |

## Data boundary

Tracked content may explain a component, show a placeholder configuration, or provide a synthetic
fixture. It must not reproduce the Owner's actual conversations, private memory, credentials,
authenticated sessions, provider responses, or machine-local paths. Runtime roots belong outside
this checkout; the ignore rules are only the final backstop.

## Current state

The four chats stand: one bot locked to the Owner's Telegram ID, carrying General, Academic, Media
and System as an agent each, with a thread-less root message answered as General and a cleared
carrier recreated by the write path — green against a local stub of each wire, so the reply path is
proven without an external call. The lane that thinks is split from the lane that talks: a slow turn
delegates to the worker chain and keeps one edited progress message up while it works. Broad search
is wired into the chats: General answers a described document with the document itself, offers three
tappable candidates on a close call and says *nothing here* when nothing answers — with the
retrieval scope bound to each chat's own connection rather than passed by a model. The capability
tool layers are future project work. Each concrete choice adds a decision record when its reason
would not be obvious from the code.
