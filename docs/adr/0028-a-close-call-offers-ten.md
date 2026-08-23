# A close call offers ten, and `ambiguous` becomes a page rather than a choice between three

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
results the Owner scans, and that is a different gesture from picking between three. ADR-0004's
framing — `confident` sends, `ambiguous` asks, `empty` admits — survives; what changes is that
asking now looks like a list.

Two consequences follow and neither is fixed here:

- **The three renderings problem gets worse before it gets better.** A chapter the corpus holds as
  `.tex`, `.pdf` and a textbook `.pdf` filled one slot in three and fills three in ten. ADR-0027
  already names this and leaves it; at ten it is more visible, and a person scanning a list will see
  it as noise rather than as three documents.
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
