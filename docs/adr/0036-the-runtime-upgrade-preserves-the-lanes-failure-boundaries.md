# The runtime upgrade preserves the lane's failure boundaries

- Status: Accepted
- Date: 2026-09-26

## Context

The 2026.6.34 runtime lock accumulated dependency audit findings. Updating transitive dependencies
alone could not repair its shipped shrinkwrap. A clean installation of 2026.9.5 removed the audit
findings but changed the failover boundary: an idle timeout was retried on the same model instead
of advancing the chain. Disabling its provider retries also disabled the retry after a partial
stream, so that setting could not preserve both existing properties.

Those properties are measured in `test/lane-death.test.ts`: abandon a silent rung on its first idle
watchdog; retry an interrupted stream once without showing the partial answer. They remain the
upgrade's acceptance gate rather than being weakened to match a candidate.

## Decision

Select OpenClaw 2026.8.1, whose clean installation reports zero npm audit findings and passes the
unchanged gateway-backed failover and delivery checks. The lockfile pins the complete installation;
installation and testing remain outside the checkout and do not alter the running deployment.

This runtime makes sensitive-value redaction unconditional and rejects the retired
`logging.redactSensitive` option. The adapter omits that option. The privacy requirement remains,
checked using the fixture's recognisable secret markers rather than by preserving a removed knob.
Explicitly configured providers need no generated plugin catalog. The privacy check follows the
actual artifacts: generated file references, resolved credentials at the local completion wire,
and absence of raw credential markers in persisted configuration, workspaces, state and logs. Any generated
JSON or SQLite plugin catalogs are also checked for managed markers.

Tool progress messages can precede a shortlist, and an unowned file warning now names its file.
The delivery checks select the actual shortlist and retain its visible numbering, while confirming
that a filename-specific warning sends no unowned document.
Tool delivery also precedes its followup completion: queuing the next scripted turn at delivery
could give that turn's keyboard response to the previous turn's followup, making the tap setup
time out. The fixture helper waits for the actual tool-result completion following its current
question before it queues another response; callback acknowledgement and routing checks remain
unchanged.

The Telegram fixture releases disconnected long polls immediately. Leaving a disconnected poll
registered for its timeout sent an injected update to a closed response during a reload and made a
working gateway look as though it had lost a message. A focused HTTP abort regression fails with
the old fixture and passes with the corrected fixture.

The native agent schema uses keyed entries and explicit ownership. The adapter names General as
owner of unrecognised Telegram carriers and the ambient system/authentication services, while
known topics retain their own agent IDs. This preserves the routing contract; omitting ownership
caused the runtime to retain incoming messages and refuse them with `AgentSelectionRequiredError`.

Agent and provider writes now land automatically. The compatibility suite observes the selected
model and provider at the completion wire, and confirms that subsequent channel reloads preserve
both. The explicit lander remains: an accepted write is not evidence that a pending reload is
already complete. Restart checks wait for the reconnected Telegram provider before injecting the
next turn; command success alone acknowledges scheduling.

Historical measurements against 2026.6.34 are retained. The 2026.9.5 migration remains separate;
a zero dependency audit is necessary but does not prove compatibility with Syrax's delivery and
failover contract.
