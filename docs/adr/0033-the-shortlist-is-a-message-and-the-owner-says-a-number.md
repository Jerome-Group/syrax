# The shortlist is a message and the Owner says a number

[ADR-0026](0026-the-shortlist-is-the-units-and-the-file-is-handed-over.md) gave a close call a
keyboard, [ADR-0028](0028-a-close-call-offers-ten.md) made it ten buttons and
[ADR-0032](0032-the-button-carries-the-number-and-the-message-carries-the-name.md) labelled them
`1`–`10`. **The keyboard is now gone.** A close call is an ordinary message, and the Owner answers
it by typing the number. [#202](https://github.com/Jerome-Group/syrax/issues/202).

The reason is not taste. It is that the front lane could not emit the tool call.

## The call was bigger than the models that had to write it

To offer ten candidates, a turn had to compose, in one function call: a ten-line `message` string,
and eleven button objects, each carrying an opaque token like `IOlsPE6F:7` transcribed exactly.

Measured over one morning, against the deployed chain:

| model | what happened |
|---|---|
| `gemini-3.5-flash-lite` | `finish_reason: function_call_filter: MALFORMED_FUNCTION_CALL` — the generation aborted |
| `openai/gpt-oss-120b` | `parameters for tool message did not match schema: /presentation/blocks/0: missing properties: 'type'`, and `/buttons/0: missing properties: 'label'` — three attempts, then the turn gave up |

Two providers, six attempts, and what reached the Owner was *"couldn't generate a response"*. The
search itself succeeded every time; the ten candidates and their scores came back in every one of
those turns. Only the call wrapped around them failed.

Three wordings were tried first — describing the block, naming its keys, and finally showing the
literal JSON — and the last of those did fix the schema errors. It did not fix the abort, because
the abort is about size and exactness rather than about shape.

**And it did not fail over.** `failoverReason: null` on every one: openclaw classifies failover from
transport signals, and a provider `finish_reason` is not one, so the chain's two fallbacks were
never consulted. A pinned session made it worse — a pin collapses the chain to one candidate, which
the log records as `attempt: 1, total: 1`.

## So the model stops composing the choice

The reply is one message the Owner reads and one number they type back. What the model emits is a
string; there is no nested structure, and **no token from the unit passes through the model's output
at all**.

`choose` takes the `answer` value the same `search` reply carried — one token, which the model was
already handling for `capture` — and the `position` the Owner said, 1-based, as written. `0` is
*none of them*, which is unambiguous because a list numbered from one has no zeroth line, and cheap
because it needs no second parameter.

**ADR-0026's real claim survives intact, and it is worth being precise about which one.** That
record is titled *the shortlist is the search unit's*, and it still is: the unit holds the
candidates, the unit maps the Owner's number onto a document, and the model is still forbidden from
working out what any number means. What ADR-0026 also did — mint a per-candidate value and put it
on a button — was the *mechanism* for that claim, and it is the mechanism that is replaced. The
boundary moved; the guarantee did not.

## What this costs, which is the part worth recording

**A typed number is ambiguous in a way a `callback_data` payload is not.** A tap carries the
shortlist it belongs to; `3` does not. Two mitigations, and neither is complete:

- The `answer` token is the model's to pass, and it is the token of the search whose reply it is
  holding — so answering an older shortlist requires the model to reach for an older reply, which
  the instruction forbids in so many words.
- A number outside the offered range answers `expired` rather than guessing, which is the same
  reply a stale tap got, and the chat's response to it — *say so and offer to search again* — is
  right either way.

The residue is real: the Owner types `3` just as a second search lands, and the model may resolve it
against the newer list. Nothing here detects that, and a tap could not have been confused this way.
It is accepted because the alternative is a shortlist that does not arrive at all.

**`declined` is no longer free.** It used to be a tap the unit read without any model seeing it,
which is what made capturing it as `not-in-the-shortlist` unambiguous (ADR-0007). Now it is the
model reading *"none of those"* out of the Owner's words and passing `0`. The capture is only as
good as that reading.

**Nothing else loses its keyboard.** System's *remove this rung* tap and the academic pair's two
confirmed writes are unchanged: those are one button, not eleven, and the tool call carrying them
has never failed. The standing line about re-passing buttons across an edit stays for them.

## Consequences

- `Shortlists.offer` mints no per-candidate value, and the reply carries no `choice` and no
  `none_of_these`. `Shortlists.resolve` takes an answer and a position.
- ADR-0032's numbering is what makes this work rather than something it replaces: the unit already
  mints `position`, and it is now the thing the Owner says rather than a button's label.
- ADR-0028's ten stands. Ten lines in a message is a page to scan, which is what that record
  already said ten buttons had become.
- The chat's instruction no longer composes a `presentation` for a close call at all, and a test
  asserts it does not — three of the last four instruction changes were a shape being guessed.

## Revisit when

- **The front lane changes.** This is a bound on what the deployed models can emit, measured on
  `gemini-3.5-flash-lite` and `openai/gpt-oss-120b`. A chain that can write eleven exact buttons
  makes the keyboard affordable again, and the keyboard is the better interface where it works.
- **A number lands against the wrong shortlist.** The race above is accepted and unmeasured. If the
  capture loop starts showing wrong documents chosen shortly after a second search, that is this.
- **`failoverReason` learns about provider finish reasons.** A malformed call that fell through to
  the next rung would have made this an annoyance rather than an outage, and it is the runtime's to
  fix rather than Syrax's.
