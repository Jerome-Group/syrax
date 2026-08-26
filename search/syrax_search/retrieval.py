"""The two arms, the one fusion over their three rankings, and the verdict returned instead of
results.

The thresholds live here rather than in a model's prompt, so they are numbers in one place that can
be tuned against real queries instead of prose a model may quietly reinterpret — and moving one is
a pull request, which is the line ADR-0007 draws between a loop that reports and a loop that
retunes itself.

`confident` originally required an absolute floor **and** a margin over the runner-up **and** both
arms agreeing. #34's trial dropped all three but the floor: the margin separated nothing and
both-arms-agree fired falsely for the pinned model. A floor on its own turned out not to be enough
either — it was read against a score belonging to whichever document fusion happened to lift, so
ADR-0025 puts back the weakest form of agreement that answers that, and no more.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field

import numpy as np

from .terms import forms_of, terms_of, words_of

# Fitted rather than tuned: 0.12 sits 0.003 above the best wrong answer on a fifteen-query
# benchmark, which is a number chosen by that benchmark's smallest gap. It is safe in the direction
# that matters — being too cautious costs a shortlist, being too eager sends the wrong file — and
# it is the first thing a grown benchmark should revisit.
CONFIDENT_FLOOR = 0.12

# The midpoint of the window that separates an unanswerable query from every correct answer, which
# is the method #34 fitted the first one by and not a number carried over from it. That first
# window ran from -0.292 to -0.172 over 14,577 chunks and gave -0.23. Measured again over 147,214,
# it runs from -0.099 to -0.006 and gives this — a maximum taken over ten times the sample is
# higher for that reason alone, which is the trigger ADR-0004 names under *Revisit when* and
# ADR-0025 acts on. Below it, `empty` had stopped firing at all.
EMPTY_FLOOR = -0.05

# What the name arm has to have matched before it excuses a document from the floor. More than half
# the query's words, because *Dummit and Foote* is a name and *my flight booking to Tokyo* matching
# a coursework filename on `booking` is not. Measured, the two are not close: a query that names its
# target covers 0.75 to 1.00 of itself and one that shares a word covers 0.33.
NAME_MATCH_MAJORITY = 0.5

# Both floors are read against `1 - distance` from the vector arm, which is the expression both
# fittings measured. ADR-0004 calls that quantity a cosine and it is not one: a `vec0` table
# without `distance_metric` returns L2. The arithmetic is reproduced rather than reinterpreted, and
# ADR-0023 is why — declaring the metric cosine and keeping these two numbers would leave a floor
# nobody has measured against wearing the authority of a measurement made against something else.

RRF_K = 60
CANDIDATE_POOL = 40

# As deep as the text arm's, and it was a tenth of it. `mh1101` alone is in 426 filenames, so ten
# was the whole of what a common module code left room for and the paper the query named sat below
# it. Measured over the benchmark, widening it moved the answer into the shortlist for one more
# query and moved four others up; 80 measured the same as 40, so this is where it stops paying.
NAME_POOL = 40

# How deep the *floor exemption* reads, which is not how deep the ranking does. A name match excuses
# a document from the empty floor (ADR-0025), and that guard's reach should not move because the
# ranking wanted a deeper pool — widening one to lift a buried answer would otherwise hand four
# times as many documents a way past the floor, silently.
NAMING_POOL = 10

# `_named_first` offers what `naming` holds, and may only *reorder* the fusion because every named
# document is already in it — which is true exactly while this pool sits inside the one the whole
# name arm is drawn from. The two are argued for different reasons above and neither implies the
# other, so the relation is stated here rather than left to be rediscovered: crossing it would put
# documents nothing ranked in front of the Owner, against ADR-0028's one claim about a shortlist.
assert NAMING_POOL <= NAME_POOL

# How much of the pool a close call offers. Three was the number ADR-0004 chose and ADR-0026 built a
# keyboard for, and #151 left the answer at rank 5, 6 and 8 for three phrasings of one query —
# inside the pool the fusion ranked, outside the shortlist drawn from it, and unreachable by any
# ordering over shared words. Measured over twenty benchmark queries the answer is offered 11 times
# at three and 15 at eight, and eight is where it stops paying: ten is two of headroom rather than a
# number this benchmark chose. ADR-0028 argues what that does to the meaning of `ambiguous`.
SHORTLIST = 10


@dataclass(frozen=True)
class Candidate:
    path: str
    name: str
    extracted: bool
    """False where only the name is indexed: the document exists and was never read."""

    def as_result(self, offered: tuple[str, int] | None = None) -> dict:
        """One document as a tool reply names it, and what an offer of it carries: value, then line.

        The pair is one argument because the two may not come apart. `position` is the line the
        Owner reads this document on, 1-based, and it is minted here for the reason `choice` is: a
        model that counts its own list can print `3.` beside the fourth name, and a tap on `3` then
        fetches a document whose name they never read (#192). A number that arrived as `null` would
        send it back to counting, so there is no way to spell that.
        """
        if offered is None:
            return {"path": self.path, "name": self.name, "contents_indexed": self.extracted}
        choice, position = offered
        return {
            "path": self.path,
            "name": self.name,
            "contents_indexed": self.extracted,
            "choice": choice,
            "position": position,
        }


@dataclass(frozen=True)
class Verdict:
    """`confident`, `ambiguous` or `empty`, and the floor that decided it.

    The scores the floor was read against are carried and never replied with. A model handed a
    number argues with it; a captured miss without one is a measurement that cannot be repeated,
    since the index that produced it is rebuilt every third day (ADR-0007).
    """

    state: str
    candidates: tuple[Candidate, ...]
    floor: float
    scores: dict[str, float] = field(default_factory=dict)
    """What each returned candidate scored on the vector arm; absent where it has no vector."""
    best: float | None = None
    """The best the vector arm reached at all, which is the number `empty` was decided on."""

    def as_reply(self, choices: list[str] | None = None) -> dict:
        """`choices` are the tap values a close call's shortlist minted, one per candidate."""
        tappable = choices if choices is not None else [None] * len(self.candidates)
        return {
            "verdict": self.state,
            "results": [
                one.as_result(None if choice is None else (choice, position))
                for position, (one, choice) in enumerate(
                    zip(self.candidates, tappable, strict=True), start=1
                )
            ],
            "floor": self.floor,
            "floor_provenance": self.provenance,
        }

    @property
    def is_a_close_call(self) -> bool:
        """`ambiguous`: the shortlist is offered here and nowhere else."""
        return self.state == "ambiguous"

    @property
    def provenance(self) -> str:
        """The two floors were fitted against different benchmarks, and only one is re-fitted.

        One string for both would have to describe the weaker of the two, and this field exists to
        stop a number wearing an authority it was not measured with.
        """
        if self.floor == EMPTY_FLOOR:
            return "re-fitted to a twenty-seven-query benchmark, provisional (ADR-0025)"
        return "fitted to a fifteen-query benchmark, provisional (ADR-0004)"


def search(
    database: sqlite3.Connection, query: str, query_vector: np.ndarray, scope: str | None
) -> Verdict:
    text, names, naming = _keyword_arm(database, query, scope)
    vector, scores = _vector_arm(database, query_vector, scope)
    ranked = fuse(vector, text, names)
    if not ranked:
        return Verdict("empty", (), EMPTY_FLOOR)

    # The floor is a statement about the vector arm's judgement, so it decides `empty` only where
    # that judgement is all there was. *Dummit and Foote* is a correct answer at -0.17 because the
    # book's own filename matched, and a document held by name alone has no vector to score at all
    # — a floor applied over those returns silence for exactly the queries that name what they
    # want (ADR-0004). A body-text hit is not the same evidence: one common word shared with a long
    # document is what the floor is there to reject, so it does not lift a query off it.
    best = max(scores.values(), default=None)
    if (best is None or best < EMPTY_FLOOR) and not naming:
        return Verdict("empty", (), EMPTY_FLOOR, best=best)

    # A document held by name alone has no vector, so it cannot clear the floor and is never
    # `confident`. That is the right way round: `confident` sends a file without asking, and a
    # filename the query happened to share words with is not grounds for sending a document the
    # index has never read inside.
    top = ranked[0]
    cleared = scores.get(top, EMPTY_FLOOR - 1) >= CONFIDENT_FLOOR
    if cleared and arms_agree(top, vector, text + names):
        return _decided("confident", database, ranked[:1], scores, best)
    return _decided("ambiguous", database, _named_first(naming, ranked), scores, best)


def _named_first(naming: list[int], ranked: list[int]) -> list[int]:
    """The fusion's own first, then the documents the query *named*, then the rest of the fusion.

    The fusion reads position and nothing else, so a document two arms rank at middling depth scores
    twice where one the query names scores once: at `RRF_K` 60, a text hit and a vector hit at rank
    five together are worth `2/66` against `1/61` for a name at rank zero. That is the right
    arithmetic for two *kinds* of evidence and the wrong one here, because the bookkeeping a corpus
    accumulates — a register naming every paper a module has — is exactly the document that hits
    both arms for any query about one of them. #187 offered ten candidates for `MH1300 2025 Midterm`
    and neither of the two files named by it was among them; five of the ten were registers and
    status notes. The paper itself was a scan carrying 941 characters, so the name was all it had.

    This is not ADR-0027 reopened. Flat fusion measured better than nested and still does; what is
    added is a precedence *below its first result*, and the precedence is one this module already
    grants elsewhere. ADR-0025 and ADR-0004 let a name match override the vector arm's judgement —
    it is what excuses a document from the empty floor, and why *Dummit and Foote* is a correct
    answer at -0.17. Evidence strong enough to lift a document off the floor is strong enough to
    keep it in the ten.

    **The first result is the fusion's and stays the fusion's, which is measured rather than
    conceded.** Naming everything ahead of it scored 13 of 27 benchmark queries led by their own
    answer against the fused 16, because more than one document passes `NAME_MATCH_MAJORITY` for an
    ordinary query — every year of a paper shares its module code and its word — so a name-ordered
    block at the head displaces the one position both arms' agreement has been fitted against.
    Below that position the benchmark scores nothing, and that is exactly where naming should win:
    the same run puts the query's own answer second where the fusion had it nowhere in the ten, and
    leaves `found` and `first` where they were.

    Rescuing only when the fusion buried *every* named document was measured too and fixes nothing —
    the 2023 and 2024 papers are named by the same query, so the rescue never fires while the one
    that was asked for stays out.

    `naming` is read as `_keyword_arm` already built it, over the same `NAMING_POOL` of ten. That
    guard's reach does not move: widening it to lift a buried answer would hand four times as many
    documents a way past the floor, which is the trade its own comment refuses.

    **Every named document is already in `ranked`, and this may only reorder.** `naming` is drawn
    from the first `NAMING_POOL` name hits and the whole name arm is one of the three `fuse()`
    consumes, so the containment holds as long as `NAMING_POOL <= NAME_POOL`. It is asserted rather
    than assumed because the two are argued separately above and neither mentions the other: raise
    the first past the second and this would start offering documents nothing ranked, which is the
    one claim ADR-0028 makes about what a shortlist contains.
    """
    return _first_seen([(one,) for one in (*ranked[:1], *naming, *ranked)])[:SHORTLIST]


def arms_agree(top: int, vector: list[int], keyword: list[int]) -> bool:
    """Both arms chose this document: the vector arm put it first, and the keyword arm ranked it.

    Fusion can hand first place to a document neither arm led with, and the confident floor is then
    read against a vector score that was never a statement about it — `00 Module Profile.md` cleared
    0.12 on 0.132 while the vector arm preferred something else and the name arm ranked it nowhere
    (#126). So `confident` asks the arm whose number is being read whether it agrees.

    This is not ADR-0004's withdrawn condition restored. That one required both arms to rank the
    document *first*, which at this corpus size takes two correct confident answers in three down
    with the wrong ones; ADR-0025 has the numbers.
    """
    return bool(vector) and vector[0] == top and top in keyword


def _match_expression(query: str) -> str | None:
    """An OR bag rather than a phrase: a description shares no exact phrase with its document.

    One group per word the person typed, holding every way that word is written, so a two-digit year
    reaches the documents that spell it out.
    """
    groups = [_any_of(forms) for forms in forms_of(terms_of(query))]
    return " OR ".join(groups) if groups else None


def _any_of(forms: tuple[str, ...]) -> str:
    quoted = " OR ".join(f'"{one}"' for one in forms)
    return quoted if len(forms) == 1 else f"({quoted})"


def _keyword_arm(
    database: sqlite3.Connection, query: str, scope: str | None
) -> tuple[list[int], list[int], list[int]]:
    """Its two halves apart, and the documents the query *names* — which lift it off the floor.

    The halves are returned rather than fused here. Fusing them first re-ranked them into positions
    and spent their agreement: a document both halves put near the top arrived at the second fusion
    worth exactly what one vector hit was worth (#151).
    """
    expression = _match_expression(query)
    if expression is None:
        return [], [], []
    text_hits = database.execute(
        """
        SELECT chunks.document_id FROM chunk_fts
        JOIN chunks ON chunks.id = chunk_fts.rowid
        JOIN documents ON documents.id = chunks.document_id
        WHERE chunk_fts MATCH ? AND (? IS NULL OR documents.path LIKE ? || '/%')
        ORDER BY rank LIMIT ?
        """,
        (expression, scope, scope, CANDIDATE_POOL),
    ).fetchall()
    name_hits = database.execute(
        """
        SELECT documents.id, documents.name FROM name_fts
        JOIN documents ON documents.id = name_fts.rowid
        WHERE name_fts MATCH ? AND (? IS NULL OR documents.path LIKE ? || '/%')
        ORDER BY rank LIMIT ?
        """,
        (expression, scope, scope, NAME_POOL),
    ).fetchall()
    written = forms_of(terms_of(query))
    naming = [one for one, name in name_hits[:NAMING_POOL] if _names_the_query(written, name)]
    return _first_seen(text_hits), _first_seen(name_hits), naming


def _names_the_query(written: tuple[tuple[str, ...], ...], name: str) -> bool:
    """How much of what was typed the document's own name accounts for.

    `name_fts` holds the whole path's words, so a document can be a name hit on a directory alone.
    The exemption asks a narrower question than the match did, and deliberately: an ancestor
    directory is shared by everything beneath it, so two of its words would carry a query over this
    line without naming anything. On the measured queries the two readings agree wherever the
    exemption is what decides the verdict.
    """
    if not written:
        return False
    words = set(words_of(name))
    matched = sum(1 for forms in written if words.intersection(forms))
    return matched > len(written) * NAME_MATCH_MAJORITY


def _vector_arm(
    database: sqlite3.Connection, query_vector: np.ndarray, scope: str | None
) -> tuple[list[int], dict[int, float]]:
    """Ranked documents and the best score each one reached, which is what the floors read."""
    rows = database.execute(
        """
        SELECT chunks.document_id, nearest.distance, documents.path
        FROM (
            SELECT chunk_id, distance FROM chunk_vectors WHERE embedding MATCH ? AND k = ?
        ) AS nearest
        JOIN chunks ON chunks.id = nearest.chunk_id
        JOIN documents ON documents.id = chunks.document_id
        ORDER BY nearest.distance
        """,
        (query_vector.astype(np.float32).tobytes(), _pool_for(scope)),
    ).fetchall()

    ranked: list[int] = []
    scores: dict[int, float] = {}
    for document_id, distance, path in rows:
        if scope is not None and not path.startswith(scope + "/"):
            continue
        if document_id not in scores:
            ranked.append(document_id)
            scores[document_id] = 1.0 - distance
    return ranked, scores


def _pool_for(scope: str | None) -> int:
    """A scoped query filters after the scan, so it asks for more than it will keep."""
    return CANDIDATE_POOL if scope is None else CANDIDATE_POOL * 10


def _first_seen(rows: list[tuple[int, ...]]) -> list[int]:
    """Chunks collapsed to their documents, keeping the best chunk's position for each."""
    ordered: list[int] = []
    for row in rows:
        if row[0] not in ordered:
            ordered.append(row[0])
    return ordered


def fuse(*arms: list[int]) -> list[int]:
    """Reciprocal rank fusion: the arms rank on incomparable scales, so only position is read.

    Every arm fuses here, once. Two of them agreeing about a document is two contributions, which is
    how a fusion that reads only position still rewards a document for matching more of the query
    than its rivals do. It was nested before — text and name fused into one keyword arm, then that
    against the vector arm — and the nesting is what discarded the magnitude #151 went looking for:
    the answer came first for five of twenty-one benchmark queries nested and nine flat.
    """
    scores: dict[int, float] = {}
    for arm in arms:
        for position, document_id in enumerate(arm):
            scores[document_id] = scores.get(document_id, 0.0) + 1.0 / (RRF_K + position + 1)
    return [document_id for document_id, _ in sorted(scores.items(), key=lambda pair: -pair[1])]


def _decided(
    state: str,
    database: sqlite3.Connection,
    document_ids: list[int],
    scores: dict[int, float],
    best: float | None,
) -> Verdict:
    """The verdict as it is answered, carrying what each document it names actually scored."""
    described = _describe(database, document_ids)
    return Verdict(
        state,
        tuple(described.values()),
        CONFIDENT_FLOOR,
        {one.path: scores[found] for found, one in described.items() if found in scores},
        best,
    )


def _describe(database: sqlite3.Connection, document_ids: list[int]) -> dict[int, Candidate]:
    placeholders = ",".join("?" * len(document_ids))
    rows = database.execute(
        f"SELECT id, path, name, extracted FROM documents WHERE id IN ({placeholders})",
        document_ids,
    ).fetchall()
    by_id = {row[0]: Candidate(row[1], row[2], bool(row[3])) for row in rows}
    return {one: by_id[one] for one in document_ids if one in by_id}
