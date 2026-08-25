# A named document is offered below the fusion's first, and above everything else

[ADR-0027](0027-the-arms-fuse-once-and-magnitude-was-not-the-fix.md) settled that the three arms
fuse **once and flat**, and that stands. What is added here is a precedence applied *after* the
fusion and *below its first result*: a document whose own name accounts for the query is offered
ahead of one whose name does not. The reason is
[#187](https://github.com/Jerome-Group/syrax/issues/187).

## Two mediocre arms outrank one exact name, and that is the arithmetic working as written

Reciprocal rank fusion reads position and nothing else. At `RRF_K` 60 a document hitting the text
arm and the vector arm at rank five is worth `2/66` = 0.0303, and a document at rank **zero** of the
name arm is worth `1/61` = 0.0164. Two middling hits beat one exact one, by design: that is how a
fusion reading only position still rewards a document for matching more of the query.

It is the wrong arithmetic for the document a corpus accumulates most of. A curation register or an
`_NTULearn.md` names every paper a module has, so it hits the text arm and the vector arm for any
query about any one of them — while the paper itself may be a scan whose OCR pass left 941
characters in a single chunk, reaching neither arm with anything and carrying its name alone.

`MH1300 2025 Midterm`, scoped to `Modules`, offered ten candidates. Neither of the two files the
query names was among them; five of the ten were registers and status notes, and three were the same
paper from the wrong year. Run alone, the name arm ranks the two 2025 files **0 and 1**. The Owner
tapped through three wrong years, tapped *None of these*, and was told the corpus held nothing.

The evidence was never missing. It was outvoted.

## The first result is the fusion's, and that is measured rather than conceded

The obvious form — every named document ahead of the fused ranking — was written first and scored
against the twenty-seven-query benchmark before it was believed:

| where a named document goes | answer offered (`found`) | answer leads (`first`) | `MH1300 2025 Midterm` |
|---|---|---|---|
| nowhere — the fusion alone | 21 of 27 | **16 of 27** | not in the ten |
| ahead of everything | 21 of 27 | **13 of 27** | offered second |
| **below the fusion's first** | **21 of 27** | **16 of 27** | **offered third** |
| only when every named one was buried | 21 of 27 | 16 of 27 | not in the ten |

**Ahead of everything costs three queries and is rejected.** More than one document passes
`NAME_MATCH_MAJORITY` for an ordinary query — every year of a paper shares its module code and the
word *midterm* — so a name-ordered block at the head displaces the one position both arms' agreement
has been fitted against. That position is what `confident` reads, what both floors are read against,
and the only one `first` scores.

**Below it costs nothing and is what is written.** Every number the report computes is identical to
the fusion's own: `found` 21, `first` 16, `best_wrong` 0.2146, `worst_right` −0.1169, and a refitted
floor of 0.218. The benchmark scores nothing about positions 2 through 10, which is precisely what
makes that the safe place to prefer a name — and the same run puts #187's own answer third where the
fusion had it nowhere at all.

**Rescuing only a query whose named documents were *all* buried fixes nothing**, and is recorded
because it is the design that sounds most conservative. The 2023 and 2024 papers are named by the
same query and were already inside the ten, so the rescue never fires while the paper actually asked
for stays out.

## This is a precedence the unit already grants

Nothing here is a new kind of evidence. [ADR-0025](0025-confident-asks-the-arm-whose-score-it-reads.md)
and [ADR-0004](0004-syrax-owns-the-file-search-index.md) already let a name match override the vector
arm's judgement: it is what excuses a document from the empty floor, and why *Dummit and Foote* is a
correct answer at −0.17. Evidence strong enough to lift a document off the floor is strong enough to
keep it in the ten. Until now it was strong enough for one and worth nothing for the other.

## Consequences

- **`fuse()` is untouched, and so are both floors, `SHORTLIST` and `NAMING_POOL`.** The reordering
  reads the `naming` list `_keyword_arm` already builds over the same ten. That guard's reach does
  not move: widening it to lift a buried answer would hand four times as many documents a way past
  the empty floor, which is the trade its own comment refuses.
- **`confident` is unreachable by naming.** It is decided on the fused ranking's first result before
  any of this runs, and still requires the vector arm's score to clear the floor and both arms to
  agree. A filename remains not grounds for sending a file unasked.
- **ADR-0028's claim that every candidate offered is one the fusion actually ranked survives.** The
  full name arm is one of the three arms fused, so a named document is always already in the ranking
  — this changes where it sits, never whether it was ranked.
- **A shortlist can now be led by a document with no vector score at all**, one place further down
  than before. `Verdict.scores` already omits a candidate the vector arm never scored, and the reply
  carries no scores in any case.

## Revisit when

- **The benchmark can see this query.** #187's miss is captured as `not-in-the-shortlist` and is
  `pending` — it has no expected path, so it is not scored. The table above measures the change
  against twenty-seven queries that never exhibited the failure. Filling that expectation in is what
  turns *costs nothing* into *fixes something* in the report's own numbers.
- **`first` moves at all.** It is 16 either way today, and it is the number this decision was chosen
  by. A change that moves it is a change to re-argue here.
- **A shortlist starts arriving full of one paper's every year.** Naming promotes all of them, in
  name-arm order. That is the right order when the year is what distinguishes them, and it is the
  renderings problem ADR-0028 already names wearing a different hat.
