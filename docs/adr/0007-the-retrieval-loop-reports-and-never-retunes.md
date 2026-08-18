# The retrieval loop reports, and never retunes itself

The search index scores itself against a benchmark that grows by capturing its own failures, states
what it found, and **changes nothing**. It never rewrites a threshold, re-ranks, or swaps the
embedder. Re-running the benchmark unasked is reporting; computing what the `confident` floor
*would* be is reporting; writing that number into configuration is a person's act with a pull
request behind it.

The line is at **configuration, not effort**. That is the distinction the record exists to hold: it
does not limit how much work the loop may do on its own, only what it may change. A loop permitted
to do arithmetic and forbidden to write configuration is doing everything useful and nothing
irreversible.

This is not an amendment to
[ADR-0004](0004-syrax-owns-the-file-search-index.md). That record's subject is how the index is
built — chunking, SQLite, the two arms of the search. This one's subject is the boundary between
testing and self-modification, which would be buried inside it.

## It is the line ADR-0003 already drew

[ADR-0003](0003-the-runtime-adapter-wraps-openclaw.md) set Hermes Agent aside for its learning
loop: a runtime that curates its own memory and writes its own skills from experience runs against
this system's standing constraint that agents do nothing more, nothing less, than what they are
configured for. A retrieval loop that re-fits its own floor once enough entries exist is the same
mechanism arriving through a different door, and a smaller one — which is exactly how it would have
got in.

So the two records are one posture rather than two coincidences. A future reader who finds a
feedback loop that captures failures and refuses to act on them, one directory along from a runtime
rejected for acting on them, should read a deliberate line rather than an inconsistency.

The alternative was live: retune the floor automatically once the set is large enough. It loses on
what it costs when it is wrong. A floor is the difference between *here is the answer* and *nothing
here*, and a wrong one is silent in both directions — an over-confident index asserts, an
under-confident one hides what it holds. Neither announces itself.

## "Wrong" was carrying five failures with three different fixes

The word had to be split before anything could be captured, because the shapes are fixed in
different places and look identical in a log:

| shape | what it is | what fixes it |
| --- | --- | --- |
| a | `confident` and wrong | the floor |
| b | shortlist without the answer in it | retrieval breadth |
| c | shortlist that buried it | the ranking |
| d | `empty` over a corpus that held it | the `empty` floor |
| e | right document, wrong granularity | the chunking |

Every capture records which shape it was. This is not taxonomy for its own sake: **all four of
[#34](https://github.com/Jerome-Group/syrax/issues/34)'s remaining misses are (e)** — a description
answered with the 500-page textbook that covers it rather than the chapter about it — and they were
handed here to be made measurable rather than felt. A format recording only "wrong" would have
flattened those four in with a bad floor and aimed the fix at the wrong knob.

## One set with two halves, and the floor is attached to a snapshot

A live capture appends to the same file the embedder trial built, each entry marked `fixture` or
`live`. Two files would mean two bars and a standing argument about which is authoritative; one
file with provenance means one bar that moves, which is the honest version of the same problem.

The consequence has to be stated rather than absorbed: **the pinned `confident` floor of 0.12 is a
number attached to a snapshot, not to the file.** #34 fitted it against fifteen queries, 0.003
above a wrong answer, and recorded it as *fitted rather than tuned*. As live entries land, the set
it was fitted against stops existing.

So the report **computes the re-fitted floor, states it beside the current one, and never applies
it.** Silence was considered and rejected: a number in a report invites rubber-stamping, and this
record's whole line erodes by convenience. It loses because the alternative to a computed number is
a human doing the fit by hand, and that is the step that never happens.

What guards it instead is provenance. The report carries the **fixture and live counts alongside**,
because a set that grows by capturing failures becomes a set of hard queries, so **a floor
re-fitted on it drifts conservative by construction** — not because retrieval got worse. A reader
who sees the re-fitted floor rising without those counts would draw exactly the wrong conclusion.

## Capture is explicit, and a model parsing the reply is not inference

The gesture is a **reply to the offending result, in plain words, routed to a capture tool**.
Nothing infers dissatisfaction from how the next message reads: inference fills the test set with
noise silently, and the lane that would do the inferring is the front one, running at low reasoning
effort.

There is a boundary worth stating plainly rather than leaving for someone to find. **A model does
parse the reply.** That is not the inference this record rejects. The trigger is the deliberate act
of replying to a result — nothing watches unsolicited messages for tone — and the parse is ordinary
tool-calling, which ADR-0003 gave to the runtime. If that distinction ever blurs in implementation,
this is the sentence it violated.

The shortlist gains a fourth **"none of these"** tap, amending
[#12](https://github.com/Jerome-Group/syrax/issues/12)'s three candidates. The shortlist is the one
place the Owner is already adjudicating, so a tap there is genuinely cheaper than a sentence. It is
also the only part of the gesture resting on a mechanism nobody had measured, which
[#53](https://github.com/Jerome-Group/syrax/issues/53) has since confirmed; the reply gesture does
not depend on it.

## What a capture must hold, and what it may leave blank

The **verdict and the scores as they stood at capture time are mandatory**. They are the only
fields a rebuilt index destroys, and without them there is no way to tell *search got worse* from
*search was always like this*.

**`expect` — the correct path — is optional, and the entry is `pending` until it has one.**
Demanding it turns one gesture into an interrogation at the moment the Owner is already annoyed,
and often the path is not something they can produce from memory. A pending entry is not inert:
*this document must not come first* is a real assertion. The scorer counts pending separately, so
they neither inflate nor deflate recall while they wait, and the report lists them — which is what
stops the set from quietly becoming mostly pending.

An entry the Owner decides was a bad test is **retired by marking, never deleted**, so the
judgement survives its subject.

## The capture format is the hard-to-reverse part

Everything else here is a line in configuration. The format is not: it accretes entries that cannot
be regenerated, because the index that produced their scores no longer exists. Changing the fields
later means migrating real measurements or discarding them. That is the reason this is an ADR
rather than a note, and the reason the mandatory fields are the ones chosen.

## CI can never run this benchmark

Every entry is a real query against a real private path under the runtime root, and
[ADR-0002](0002-the-public-boundary-and-mit-license.md)'s public boundary means none of it can be
committed here. **It runs on the mini or it does not run.** This is recorded because it will read
as an omission later — a benchmark with no CI job looks like an oversight rather than a boundary.

The split falls out cleanly: **the runner is public repository code, and the data stays under the
runtime root.** That also rescues the scorer from the throwaway prototype branch it lives on today,
where the first re-run months from now would mean rebuilding it — which is how a benchmark becomes
a file nobody reads.

## Consequences

- The floor can be wrong for as long as it takes a person to act on a report. That is the accepted
  cost of the line, and it is chosen over an index that changes underneath its own measurements.
- The re-fitted number drifts conservative as the set grows, permanently. It is legible only with
  the fixture and live counts beside it, so a report that drops them is worse than no report.
- The benchmark is scored on the index's own 3-day re-embed pass and on demand, with **no new
  launchd unit** — the existing search agent is poked, keeping
  [ADR-0005](0005-launchd-supervises-syrax-as-two-launchagents.md)'s single answer to *what can
  message me unprompted*. Nightly was rejected: if neither the index nor the model moved, the number
  is identical, and a report that says the same thing every morning trains the Owner to ignore it.
- Results are read as a **retrieval report** in the System chat, exceptions-only, and written to a
  file either way — an agent in the checkout cannot read Telegram. The term exists because it
  collides with **usage report**: same chat, same trigger, same shape, different subject.
- The benchmark directory gets a local `git init` that is **never pushed**. Nothing tracks the file
  today, so a fat-fingered edit is unrecoverable; it costs nothing, and the data cannot leave the
  mini by construction.
- **The map's memory fog is not graduated by this.** #35 opened claiming capture would need chat
  history retained, which was true of a `/wrong`-means-last-search gesture and false of the one
  chosen: Telegram's `reply_to_message` is the state, so Syrax retains nothing. The fog stands
  unedited, and its trigger — oldest-first trimming losing something the Owner misses — is untouched.

## Revisit when

- A shape outside the five appears, or one of them turns out to have two fixes. The `kind` field is
  the whole reason the fix can be aimed, and a sixth shape means the vocabulary was wrong.
- The live half outgrows the fixture half enough that the conservative drift stops being a caveat
  and starts being the number. The counts are in the report so that this is visible rather than
  inferred.
- Someone proposes writing the re-fitted floor automatically "just for the empty threshold", or any
  other single exception. That is this record's line, and the exception is the shape it fails in.
