# A spent claim in an ADR body is marked in place, and never rewritten

A claim in a record's body that a later record has spent may carry a **spent-claim mark**: an italic
parenthetical, immediately after the claim, naming the record that spent it and linking to it. Where
the claim was not merely overtaken but **wrong**, the mark is a `~~strikethrough~~` on the wrong
words plus that same parenthetical. Nothing else about the body may be touched — the claim itself is
not rewritten, not deleted, and not re-argued.

**This amends [ADR-0001](0001-decisions-are-recorded-as-adrs.md) in one part** — its *"the **one**
edit an existing record takes is the pointer forward"*. There are now two, and the second is bounded
below. Everything else in ADR-0001 stands: the shape, the filename rule, the immutability of
reasoning, and the pointer forward itself, which remains required and is not replaced by this.

## The failure this fixes is ADR-0001's own, named in ADR-0001

ADR-0001 justifies the pointer-forward exemption like this:

> the alternative is worse than untidy: a record found on its own, from a link in an issue,
> otherwise reads as current when it is not.

That is exactly right, and it is only half-fixed. **A record found from a link in an issue is
usually read from the middle**, not from the top — the link points at the section that matters, and
a long record puts the pointer forward a long way above it.

[ADR-0015](0015-the-scratch-root-stays-in-tmp-and-the-preflight-asserts-its-mode.md) is the
measurement. Its *"The scratch surface is larger than one directory"* section opens *"Noted and
deliberately not decided."* at **line 165 of a 205-line record** — 159 lines below the title, and
below its pointer forward.
[ADR-0017](0017-the-gateway-lock-directory-is-not-relocated-and-the-preflight-creates-it-at-0700.md)
answered it, and ADR-0015's pointer forward says so — but a reader who arrived at that section from
[#108](https://github.com/Jerome-Group/syrax/issues/108) reads a live question that has been closed,
with no signal in front of them that it has been.

[#114](https://github.com/Jerome-Group/syrax/issues/114) asked for that sentence to stop deferring
and [PR #115](https://github.com/Jerome-Group/syrax/pull/115) could not deliver it. That is the
first time the one-edit rule has cost a criterion, and it is what made this worth deciding rather
than leaving as a preference.

## Two marks, because the two cases are not the same

| the claim was | mark |
| --- | --- |
| **right, and overtaken** | italic parenthetical, linked |
| **wrong** | `~~strikethrough~~` on the wrong words, plus the parenthetical |

**They are not interchangeable, and using the wrong one is a factual error rather than a style
slip.** Striking a claim that was correct asserts a mistake nobody made, which is the opposite of
what ADR-0001 protects — the reasoning that was true at the time is what makes a later reversal
legible, and a strikethrough tells the reader it was never true. ADR-0015's deferral is the case in
point: *"Noted and deliberately not decided"* was accurate, deliberate, and is now answered. It gets
the parenthetical alone.

The reverse error is milder but still wrong: a parenthetical on a claim that was false leaves the
false claim reading as an alternative view.

## The practice exists here, and this is deliberately stricter than it

`docs/research/telegram-surface.md` is where in-body marking already happens in this repository, and
it is the origin of the two shapes above rather than a precedent that can be pointed at and copied.
**It does not conform to the rule this record sets, in three named ways** — recorded here because
the temptation for a later session is to read the research document as the worked example:

- **It rewrites in place.** *"the user may create ~~and delete~~ topics"* is conforming; but the
  9.4 entry reads `~~create/delete~~ **create**` — the wrong words struck *and a corrected
  replacement set beside them*. That is the rewrite forbidden below.
- **It strikes claims that were overtaken rather than wrong.** A withdrawn recommendation is struck
  through and replaced with bold prose, which is exactly the confusion the two marks exist to
  prevent.
- **Its parentheticals carry argument.** The `sendMessageDraft` note goes on to explain *"the
  measurement was a bare `curl`…"* and to correct a rate figure. That is reasoning added to the
  body, which is the thing this exemption may not do.

None of that is a defect *there*. **A research document is a working document and is meant to be
revised; a record is not.** That difference is the whole reason this record has a prohibition list
and the research document does not, and it is why the practice is being tightened on the way in
rather than adopted as it stands.

## The test this passes is ADR-0001's own

ADR-0001 exempts the pointer forward on a stated test rather than by fiat:

> It adds no reasoning and removes none, which is why it is not the thing the paragraph above
> forbids.

A mark meets the same test, and that is the whole argument for it — this is not a new exemption with
a new justification, it is the existing exemption applied where it already reaches.

- It **adds no reasoning**: the parenthetical names the record that spent the claim and links to it.
  The argument lives in that record; the mark is a pointer with better placement.
- It **removes none**: the claim stays legible and in full. A strikethrough is a rendering, not a
  deletion — the words remain on the page and in `git`.

What would fail the test is rewriting the sentence to say what is now true, which is why that is
forbidden below rather than left to judgement.

## What may not be done under this

The exemption is narrow on purpose. An immutability rule that loosens once will be read as loose, so
the boundary is stated rather than implied:

- **The claim is not rewritten.** Not corrected, not rephrased, not updated to the current position,
  and no replacement is set beside it.
- **The claim is not deleted**, and neither is anything around it.
- **No argument is added.** The parenthetical names the record that spent the claim and links to it.
  It does not say why, does not summarise that record, does not restate the test, and does not
  defend either position. **One clause is the budget.**
- **Placement is fixed**: immediately after the claim it marks, in the same paragraph or list item.
  Not under the nearest heading, not at the end of the section. A mark a reader can arrive below is
  the failure this record exists to fix.
- **It names exactly one record**, and links it. Not two records, not a ticket instead of a record —
  a claim is spent by a decision, and a decision here is an ADR. A ticket may ride along only inside
  the named record's own link text.
- **No section is added or removed**, and no heading changes.
- **A record with no pointer forward gets no mark.** The pointer stays required and comes first; a
  mark without one is a record whose top still reads as current.
- **The pointer forward is not rewritten to describe the mark.** It is the other edit, governed by
  ADR-0001, and this exemption does not reach it.

The one-sentence version, for a session that reads nothing else: **name the record, link it, and
change nothing else.**

## Consequences

- **`git` is now the only place a record's body is pristine**, and that is a real loss. A reader who
  wants the record exactly as written has to go to the history for it. Accepted, because the mark
  preserves the words and the alternative loses readers who never learn the claim was spent.
- **Every long record becomes a candidate**, and nothing forces a mark to be added. A record can be
  amended without its body being marked, so the directory will hold a mix — and a section with no
  mark does not prove it is unspent.
- **A mark can go stale in the way a pointer cannot.** It names one record; a second amendment to
  the same claim needs that mark extended rather than a second one beside it, and this record does
  not say how.
- **This is the second exemption to immutability, and the first one's precedent is now doubled.**
  A third is measured against two, which is a weaker bar than one. That is the cost of deciding this
  at all, and it is why the boundary above is a list rather than a principle.
- **The strikethrough branch has no live case.** Every claim spent in `docs/adr/` today was right
  when written. It is specified anyway, because deciding which mark applies *while* marking is how
  the two get conflated — but it is untested, and the first use should be read carefully.
- **No record before this one carries a mark.** All seventeen were checked when this was written, by
  `git grep` for both shapes across `docs/adr/`. So an unmarked body means nothing about whether its
  claims hold, for every record written before now.

## Revisit when

- **A mark is found carrying an argument**, or set anywhere but immediately after its claim. Those
  are the two boundaries most likely to erode, and the first violation means the list needs to
  become a shape rather than a prohibition.
- **A claim needs a second mark.** The stale case above is unhandled by design, on the grounds that
  it has not happened; the first time it does, this record is what needs extending.
- **The strikethrough branch gets its first real use.** It is the untested half.
- **The directory gets an index**, which ADR-0001 anticipates. An index showing what each record
  supersedes and amends may make in-body marks redundant for the reader arriving from a link, and
  the loss above stops being worth paying.
