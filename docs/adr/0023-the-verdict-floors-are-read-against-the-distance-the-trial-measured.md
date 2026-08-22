# The verdict floors are read against the distance the trial measured

`0.12` and `-0.23` are read against `1 - distance` from the vector arm, exactly as
[#34](https://github.com/Jerome-Group/syrax/issues/34)'s trial computed them.
[ADR-0004](0004-syrax-owns-the-file-search-index.md) calls that quantity a **cosine** and it is not
one. A `sqlite-vec` `vec0` table declared without `distance_metric` returns **L2**, and the trial
declared one without it, so every number in that record's threshold section is `1 - L2` between
unit vectors rather than a cosine similarity.

The implementation reproduces the arithmetic rather than correcting it.

## Correcting it would leave two fitted numbers attached to nothing

The obvious move is to declare `distance_metric=cosine` and keep the floors, and it is the wrong
one. Both floors were **fitted to a distribution**, not derived: `0.12` sits 0.003 above the best
wrong answer on a fifteen-query benchmark, and `-0.23` sits inside a window from -0.292 to -0.172
that separated an unanswerable query from every correct answer. Change the quantity underneath and
those two numbers no longer sit anywhere in particular — they would be a cosine floor nobody has
ever measured against, wearing the authority of a measurement that was made against something else.

The two are monotonically related for unit vectors, so nothing about the *ranking* changes either
way. What changes is only whether the recorded numbers still mean what they were fitted to mean.

## The verification stays possible, which is the point

Reproducing the expression keeps [#35](https://github.com/Jerome-Group/syrax/issues/35) able to do
its job. Growing the benchmark and re-fitting the floor is a comparison against the old fit, and a
comparison needs both sides measured the same way. A silent metric change would have made the first
re-fit look like retrieval drift.

Switching to cosine is available later and costs one line plus a re-fit — as an explicit change
with its own numbers, which is [ADR-0007](0007-the-retrieval-loop-reports-and-never-retunes.md)'s
line rather than a tidy-up.

## Consequences

- ADR-0004's threshold section is marked in place where it names the metric wrongly
  ([ADR-0018](0018-a-spent-claim-in-an-adr-body-is-marked-in-place.md)'s strikethrough shape, since
  the claim was wrong rather than overtaken). The numbers in it stand; the word does not.
- `retrieval.py` carries the same correction beside the constants, because that is where somebody
  about to "fix" the metric is standing.
- The glossary is untouched: no term said cosine.

## Revisit when

- The benchmark grows enough to re-fit the floors, which is the moment the metric can be changed
  for free — the re-fit is happening anyway, and both sides of it would be measured the same way.
