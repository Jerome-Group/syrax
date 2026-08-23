# `confident` asks the arm whose score it reads, and the empty floor is re-fitted

Two guards on when the search unit is allowed to *assert*, with one cause between them: both
numbers in [ADR-0004](0004-syrax-owns-the-file-search-index.md) were fitted against
[#34](https://github.com/Jerome-Group/syrax/issues/34)'s single folder, and the corpus they now
govern is ten times that. This is the record those two amend.

- **The empty floor moves from −0.23 to −0.05**, by the same method that produced −0.23 and not by
  preference. Below it, `empty` had stopped firing on the real corpus altogether.
- **A name match excuses a document from the floor only if it accounts for more than half the
  query**, rather than for one word of it.
- **`confident` requires the vector arm to have chosen the document its score is being read for**,
  and the keyword arm to have ranked it at all.

Everything here is measured on the finished index — 14,899 documents, 147,661 chunks — over the
fifteen fixture queries, six unanswerable ones, and the six live captures on
[#126](https://github.com/Jerome-Group/syrax/issues/126). The numbers are in
[#155](https://github.com/Jerome-Group/syrax/issues/155)'s pull request rather than reprinted whole
here; what follows is what they decided.

## The floor had stopped firing, for two different reasons

`empty` never occurred on the real corpus. Every unanswerable query returned a three-document
shortlist of the least-bad matches, which is the failure ADR-0004 built the floor to prevent and the
thing [#125](https://github.com/Jerome-Group/syrax/issues/125) is not allowed to ship on top of.

**The number was overtaken by the corpus, exactly as ADR-0004 said it would be.** −0.23 sat in a
window from −0.292 to −0.172 measured over 14,577 chunks. Over 147,214, six unanswerable queries top
out between −0.203 and −0.099 and the answers run from −0.006 upward: a maximum taken over ten times
the sample is higher for that reason alone. ADR-0004 names this under *Revisit when* — "the corpus
grows by an order of magnitude" — and it arrived by that door and not by drift.

So the floor is re-fitted by ADR-0004's own method, the midpoint of the separating window:
**−0.05**, in a window from −0.099 to −0.006. What makes this a re-fit rather than a nudge is that
the method is the one that produced the number being replaced. It is fitted, not tuned, and it is
provisional in exactly the way 0.12 is.

**The other reason is a door the floor left open, and no number would have closed it.** A query is
lifted off the floor when the name arm matched, because *Dummit and Foote* is a correct answer at
−0.17 that wins on its filename alone. But the arm matches an OR bag of terms, so *my flight booking
to Tokyo* matched a coursework filename on `booking` and was exempted on the strength of one word
in three. That query is the fixture set's own `should-be-empty` case, and it could not have been
made empty by moving the floor.

**So the exemption asks how much of the query the name accounted for**, and the measurement says
the two cases are not close: a query that names its target covers 0.75 to 1.00 of itself, and one
that merely shares a word covers 0.33. The line is **more than half**, drawn in the gap rather than
at either edge of it. After both changes, all seven queries that should be empty are, and no
answerable query became silence.

## `confident` was decided by a score belonging to another document

`confident` sends a file into a chat without being asked. It is reached by reading the vector arm's
score for the fused top result against a floor of 0.12 — and fusion can hand first place to a
document that neither arm led with. On #126's capture, `00 Module Profile.md` was fused first,
scored 0.132, cleared the floor, and was sent: the vector arm had ranked something else first and
the name arm had ranked it nowhere. The two arms disagreed completely and nothing noticed. Four of
twenty-seven queries were confident and wrong this way.

The guard is the weakest thing that answers it: **the arm whose number is being read must have
chosen the document.** A score is a statement the vector arm made about its own best candidate;
asking it about a document fusion promoted is a category error, not a threshold problem. The
keyword arm must also have ranked the document — measured, that never changed an outcome on its
own, and it is what makes the condition *the arms agree* rather than *the vector arm agrees*.

**This is not ADR-0004's withdrawn condition restored, and the difference is measured.** That one
required both arms to rank the document **first**, independently. Re-read at this corpus size it
still fires falsely, exactly as #34 found: it takes the confident-and-wrong count from four to one,
and the confident-and-*right* count from three to one with it. The guard adopted here takes wrong
from four to one and leaves all three right answers standing. #34's finding survives its re-reading;
what did not survive was the assumption that a floor alone could stand in for it.

## What is left standing, and left alone

One confident-and-wrong survives: `MH1101 Calculus II examination May 2026` returns
`01 MH1101 Calculus II Test Information.pdf`, and both arms genuinely do agree on it. That is a
ranking failure and not an agreement failure, which is why
[#151](https://github.com/Jerome-Group/syrax/issues/151) keeps it. Naming the distinction is the
point: a guard that also swallowed this one would have been a guard fitted to a query.

Nothing here touches ranking. The two-digit year and fusion's blindness to magnitude are untouched
and still cost the captured query its first place.

## Consequences

- **Shortlists get longer in the honest direction.** Two queries that were confident and wrong are
  now three-document shortlists that still do not contain the answer. The verdict is better; the
  ranking behind it is not, and #151 is where that is measured.
- **`empty` is now a reply General has to render**, which is #125's criterion and was unreachable
  before this.
- **The fixture suite's stub embedder is calibrated against the pinned floor**, so moving the floor
  moved two fixture queries across it. They were restated rather than deleted, and the conftest
  docstring says what the stub's scale now has to hold.
- ADR-0004's −0.23, its single-condition `confident`, and its *Revisit when* line about an order of
  magnitude are marked in place.

## Revisit when

- **The corpus grows by another order of magnitude**, which will move −0.05 the same way it moved
  −0.23. This is now the second observation of that effect and the first at which its cause is
  recorded, so the third should ask whether a fitted constant is the right shape at all, rather
  than fitting a fourth one.
- **The benchmark outgrows twenty-seven queries.** Both floors are fitted to it, and #126's capture
  loop is what grows it.
- **`empty` starts arriving for queries the corpus can answer.** That is the failure this direction
  buys, it is shape (d) in ADR-0007, and it is the one to watch after #125 puts these verdicts in
  front of a person.
