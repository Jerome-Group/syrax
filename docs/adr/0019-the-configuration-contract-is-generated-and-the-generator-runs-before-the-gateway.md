# The configuration contract is generated, and the generator runs before the gateway

Syrax's runtime configuration is produced by TypeScript under `src/adapter/`, written to a path
outside the checkout by `src/cli/generate-config.ts`, and read by the gateway as an ordinary file.
The generator runs at provisioning time and exits. Nothing it produces is consulted again, and
nothing in this repository is loaded by the runtime.

## This is not the code layer ADR-0003 forswore

[ADR-0003](0003-the-runtime-adapter-wraps-openclaw.md) made the adapter _"a contract expressed in
configuration rather than a layer of code standing in front of the runtime"_, and named the
standard mistake: a wrapper written to make the runtime swappable, which hides the runtime's own
features behind whatever the wrapper anticipated and then has to be rewritten when the runtime is
replaced.

A generator is the opposite shape, and the distinguishing test is **where it sits at runtime**. A
wrapper is on the request path: every turn passes through it, so every runtime feature it did not
anticipate is unreachable. This one is on the _provisioning_ path. The artefact it produces is the
runtime's own configuration in the runtime's own vocabulary — a key it has never heard of passes
through it untouched, because it does nothing but assemble an object and serialise it.

What is gained is that the decisions become checkable. `agents.defaults.skills: []` in a
hand-written file is a line nobody can go red over; the same line behind `agentDefaults()` is
asserted by a test that fails when a future edit inherits a default instead of stating it. Eight
of ADR-0011's, ADR-0008's and ADR-0016's settings are now held by assertions rather than by
whoever last read the record.

## The inputs are a file, because two of them are private and one is a wire

The generator takes a **deployment**: the roots the runtime must be told about rather than left to
choose, the single Telegram account that is answered, and the two base URLs. Three of those are
private runtime state or machine-local paths, so the deployment file lives outside the checkout
with the rest of it and only its shape is public.

The two wires being deployment inputs rather than constants is what lets the suite point them at
local stubs. That is the seam the spec asked for, and it costs one field each: a self-hosted Bot
API root is a documented deployment property upstream, and a provider base URL is already per
provider.

## Refusing before writing

The generator refuses on an insecure secrets store and on any root inside the checkout, before it
writes anything. Both failures are cheap here and expensive later: the runtime checks the store's
mode at the moment of use, so a wrong mode otherwise surfaces as a gateway that starts and refuses
every turn, and a root inside the checkout is a private path one `git add` from being public.

It does not check what it cannot: whether the credential behind a ref is the right one, whether a
model id still answers. The first is the wizards' (ADR-0010), the second is the rung watch's
(ADR-0012).

## Consequences

- **The generated file is not tracked and never should be.** It carries machine-local paths and
  the Owner's Telegram ID. What is tracked is the generator and the tests over it.
- **Regenerating is the deployment path.** A decision changes in `src/adapter/`, the generator runs,
  the gateway restarts. There is no partial edit of a live configuration, which is what keeps the
  documented contract and the deployed one from drifting.
- **A runtime key Syrax has no opinion about is simply absent**, and the runtime's own default
  applies. That is the correct outcome and is why `requireTopic` is unset rather than set to
  `false`: unset and empty are distinguishable to the runtime, and the spec asked for the first.
- **The generator is a second thing that can be wrong.** It is small and it is tested, but a
  hand-written file has no such failure mode, and that is the honest cost of the trade.

## Revisit when

- **A decision cannot be expressed as a static object.** Everything here is one today. Something
  that had to be computed from live state at generation time would be a different kind of program.
- **The runtime gains a configuration language of its own** that could carry these assertions, at
  which point the generator is a layer between two things that agree.
