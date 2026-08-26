# A close call offers ten, and `ambiguous` becomes a page rather than a choice between three

> **Amended by
> [ADR-0032](0032-the-button-carries-the-number-and-the-message-carries-the-name.md)** in one: a
> button carries its candidate's number rather than its name, and the names are the message. The
> count of ten stands; what the ten look like does not.

[ADR-0004](0004-syrax-owns-the-file-search-index.md) chose three candidates and
[ADR-0026](0026-the-shortlist-is-the-units-and-the-file-is-handed-over.md) built a keyboard for
three buttons. The shortlist is now **ten**, and the reason is the residue
[#151](https://github.com/Jerome-Group/syrax/issues/151) refused to tune away.

## Three was leaving the answer inside the pool and outside the reply

#151 fixed the fusion and left three captured phrasings of one query returning the paper at ranks
**5, 6 and 8**. Every one of those is inside the forty documents the fusion ranked and outside the
three it offered. They are not a ranking bug: `MH1101 Final 25/26` returns
`MH1101_Final_2026_Expected` first, that document's name says *final*, and the paper's name says
*Semester 2* — the document above it genuinely matches more of the query. What the Owner means is
that *final* implies the semester's paper, and no ordering over shared words holds that.

So the lever is not the ordering. It is how much of the ordering a person gets to see.

Measured over the twenty benchmark queries as #151 left them:

| shortlist | answer offered |
|---|---|
| 3 | 11 of 20 |
| 5 | 12 of 20 |
| **8** | **15 of 20** |
| 10 | 15 of 20 |
| 12 | 15 of 20 |

**Eight is where it stops paying, and ten is what is written.** The two beyond are headroom, said
plainly rather than fitted: a number chosen to sit exactly on this benchmark's worst surviving rank
is a number that has to move the first time a rank becomes nine. Twelve buys nothing either, and the
pool is forty, so ten is never padding — every candidate offered is one the fusion actually ranked.

## What it costs, which is the part worth recording

**`ambiguous` stops meaning *a close call between three documents*.** Ten buttons is a page of
results the Owner scans *(the page moved into the message and the buttons became its numbers —
[ADR-0032](0032-the-button-carries-the-number-and-the-message-carries-the-name.md). A button holds
about twelve characters, which was shorter than the part these names have in common.)*, and that is
a different gesture from picking between three. ADR-0004's framing — `confident` sends, `ambiguous`
asks, `empty` admits — survives; what changes is that asking now looks like a list.

**The tail is not worse than the head, and that was measured rather than assumed.** The obvious
objection to a longer shortlist is that nothing filters positions 4 through 10: the `empty` floor is
read against the *best* score for the whole query and never per candidate, so a longer list could
mean a longer tail of documents that would have been *nothing here* on their own. Measured on the
three captured phrasings, it does not. For `MH1101 Final 25/26` the ten offered span −0.064 to
−0.004 — a band narrower than the gap the floor was fitted across — and the document at rank 1
scores **below** the one at rank 5. A per-candidate floor at −0.05 would delete the top result and
keep the fifth. So there is no filter to add here that is not noise, and the reason is structural:
everything reaching the fused top ten is a keyword match on a specific module code, and the vector
arm barely separates those from each other.

Two consequences follow and neither is fixed here:

- **The three renderings problem gets worse before it gets better.** A chapter the corpus holds as
  `.tex`, `.pdf` and a textbook `.pdf` filled one slot in three and fills three in ten. ADR-0027
  already names this and leaves it; at ten it is more visible, and a person scanning a list will see
  it as noise rather than as three documents. It is not only chapters: ten offered for *where is it
  shown that the composition factors of a group are unique* hold `Abstract Algebra 3e Dummit, Foote`
  twice at identical scores and `A Course on Group Theory Rose` twice, because the corpus holds two
  copies of each under different paths. Four of ten slots, two books.
- **Nothing yet knows whether anyone taps past the third.** That is exactly what
  [#126](https://github.com/Jerome-Group/syrax/issues/126)'s capture loop measures, and it is the
  evidence this record should be re-read against.

## Consequences

- `SHORTLIST` is the one constant. The tool description and the chat instruction read from the shape
  of the reply rather than restating a number — the instruction already said *one button per result*
  and needed no change.
- The shortlist plumbing was already size-agnostic: a tap carries a token and a position, and
  `Shortlists.offer` mints one value per candidate however many there are.
- ADR-0004's *renders as three candidates* and ADR-0026's *three buttons* are marked in place.

## Revisit when

- **The capture loop can say where the Owner taps.** If nothing below the third is ever chosen, ten
  is a wall of buttons bought for nothing, and the honest move is back down rather than sideways.
- **A shortlist starts arriving full of one document.** The renderings problem is the likeliest way
  ten becomes worse than three.
- **The pool stops being deeper than the shortlist.** At forty it is; a shortlist that reached the
  bottom of the pool would be offering documents nothing ranked.
