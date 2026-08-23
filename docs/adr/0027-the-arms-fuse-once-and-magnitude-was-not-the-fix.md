# The arms fuse once, and magnitude was not the fix

[#151](https://github.com/Jerome-Group/syrax/issues/151) set out to make reciprocal rank fusion read
magnitude, on the diagnosis that it "gives a document matching all four query terms the same credit
as one matching two". The diagnosis was right about the symptom and wrong about the cause, and the
measurement is what said so. This record exists mostly so the rejected fix is not proposed a third
time.

- **The three arms fuse once**, at equal weight, instead of the keyword halves fusing into one arm
  that then fuses against the vector arm.
- **A two-digit year means the four-digit one**, as a rule and not a table.
- **The name pool is as deep as the text pool**, 40 rather than 10.
- **Weighting a document by how much of the query its name accounts for is measured and rejected.**

Scored over twenty benchmark queries — #34's fifteen, less the one whose answer is nothing, plus the
six captures on #126 — the answer came **first for 5 and rose to 9**, and no query that returned the
answer stopped returning it. [ADR-0004](0004-syrax-owns-the-file-search-index.md) is the record this
amends.

## The nesting was the magnitude loss

The keyword arm had two halves, and it fused them before the fusion: `text` and `name` became one
ranked list, and *that* list met the vector arm. Fusing a rank into a rank quantises it twice. A
document both halves put near the top arrived at the second fusion holding one position — worth
exactly what a single vector hit at rank 1 was worth — and lost to it on insertion order.

That is the whole of *Dummit and Foote* landing second. Its own filename was the name arm's first
result and it was second overall, behind a document the vector arm liked, because the keyword arm's
margin had already been spent.

Fusing all three at once fixes it without a parameter: **two arms agreeing about a document is two
contributions**. A fusion that reads only position still rewards a document for matching more of the
query, because matching more of the query is what puts it in more than one arm and higher in each.

## Magnitude, added deliberately, made it worse

The obvious reading of #151 is to weight the name arm by the share of the query its name accounts
for. That was built and measured against the same twenty queries, in four shapes:

| | answer first |
|---|---|
| nested, as it stood | 5 |
| **one fusion, three arms** | **9** |
| one fusion, name arm weighted by coverage ×1.5 | 8 |
| one fusion, name arm weighted by coverage ×3 | 6 |
| one fusion, name arm weighted ×1.5 regardless of coverage | 8 |
| one fusion, keyword arms contributing normalised bm25 instead of position | 6 |

Every shape that read magnitude explicitly scored *below* the one that did not. The reason is
legible after the fact: a filename is a strong signal for a query that names a document and a weak
one for a query that describes it, and eight of the fifteen fixture queries describe. Weighting the
name arm up trades those away for the ones it helps, and there are more of them.

**So the arms stay at equal weight and the shape is the flattening.** Reading magnitude was the
hypothesis; it was tested rather than adopted, which is the only reason this record can say it is
wrong rather than that it felt wrong.

## A two-digit year, and a pool deep enough to hold the answer

`25/26` and `2025-2026` are one thing to the person typing and two tokens to FTS5. The rule is that
**a two-digit number also means the year it is short for**, prefixed with this century — expanded
into the match expression as an OR group, and honoured by the test for whether a name accounts for
the query, so a document cannot match on a year and then be told it was not named by one. It is
wrong for a document from 1994, and that is accepted: this corpus is this decade's coursework, and
the cost of being wrong is one weak extra term in a bag that is already an OR.

The name pool was 10 against the text arm's 40. `mh1101` alone is in 426 filenames, so ten was the
whole of what a common module code left room for and the paper the query named sat below it.
Measured, 40 puts one more answer into the shortlist and lifts four others; 80 measures the same as
40.

## What this does not fix, and why it is not tuned until it does

**Three of the six captured phrasings still do not return the paper first, and the documents above
it match more of the query than it does.** `MH1101 Final 25/26` returns `MH1101_Final_2026_Expected`
first: the query says *final*, that document's name says *final*, and the paper's name is
`MH1101 2025-2026 Semester 2` and does not. Every rule in this record ranks it correctly. What the
Owner means is that *final* implies the semester's paper, and no ordering over shared words can
know that — it is the vector arm's job, and the vector arm scores it low.

Tuning until those three pass is available and is exactly what #151 was written to prevent. They are
recorded as what they are: the answer sits at rank 5, 6 and 8 of the fused list, inside the pool and
outside a shortlist of three.

**One correct `confident` became a correct `ambiguous`.** The Odyssey chapter exists as `.tex`,
`.pdf` and a textbook `.pdf`; the vector arm leads with the `.tex` and the fusion now leads with the
`.pdf`, so [ADR-0025](0025-confident-asks-the-arm-whose-score-it-reads.md)'s agreement condition sees
a disagreement that is really a tie between three renderings of one chapter. The answer is still
first. Chasing it would mean teaching the index that those three are one document, which is a
different ticket from this one.

## Consequences

- `fuse` is public, because the property that the arms fuse once is the thing a test has to be able
  to name.
- The keyword arm returns its two halves rather than one fused list. Nothing else reads them, and
  ADR-0025's *the keyword arm ranked it* is their union, which is what it always was.
- The fixture corpus gains a document whose name carries a year and whose body does not, so the
  equivalence is tested by reaching a document that is otherwise unreachable.

## Revisit when

- **A query that describes rather than names starts mattering more than one that names.** The
  measurement above is a property of this benchmark's mixture — eight describe, six name, six are
  the captures. A benchmark grown by live capture will not keep those proportions, and the equal
  weights are fitted to them.
- **The three renderings of a chapter become worth telling apart from three documents.** It costs a
  `confident` here and it would cost more in a shortlist of three, which can be filled by one
  chapter three times.
- **Anything proposes reading magnitude again.** The four shapes above are the measurement to beat,
  not an argument to repeat.
