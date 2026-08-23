"""The two arms, their fusion, and the verdict the tool returns instead of results.

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
from dataclasses import dataclass

import numpy as np

from .terms import terms_of, words_of

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
NAME_POOL = 10
SHORTLIST = 3


@dataclass(frozen=True)
class Candidate:
    path: str
    name: str
    extracted: bool
    """False where only the name is indexed: the document exists and was never read."""


@dataclass(frozen=True)
class Verdict:
    """`confident`, `ambiguous` or `empty`, and the floor that decided it. Never a score."""

    state: str
    candidates: tuple[Candidate, ...]
    floor: float

    def as_reply(self) -> dict:
        return {
            "verdict": self.state,
            "results": [
                {"path": one.path, "name": one.name, "contents_indexed": one.extracted}
                for one in self.candidates
            ],
            "floor": self.floor,
            "floor_provenance": "fitted to a twenty-seven-query benchmark, provisional (ADR-0025)",
        }


def search(
    database: sqlite3.Connection, query: str, query_vector: np.ndarray, scope: str | None
) -> Verdict:
    keyword, naming = _keyword_arm(database, query, scope)
    vector, scores = _vector_arm(database, query_vector, scope)
    ranked = _fuse(vector, keyword)
    if not ranked:
        return Verdict("empty", (), EMPTY_FLOOR)

    # The floor is a statement about the vector arm's judgement, so it decides `empty` only where
    # that judgement is all there was. *Dummit and Foote* is a correct answer at -0.17 because the
    # book's own filename matched, and a document held by name alone has no vector to score at all
    # — a floor applied over those returns silence for exactly the queries that name what they
    # want (ADR-0004). A body-text hit is not the same evidence: one common word shared with a long
    # document is what the floor is there to reject, so it does not lift a query off it.
    best = max(scores.values(), default=EMPTY_FLOOR - 1)
    if best < EMPTY_FLOOR and not naming:
        return Verdict("empty", (), EMPTY_FLOOR)

    # A document held by name alone has no vector, so it cannot clear the floor and is never
    # `confident`. That is the right way round: `confident` sends a file without asking, and a
    # filename the query happened to share words with is not grounds for sending a document the
    # index has never read inside.
    top = ranked[0]
    if arms_agree(top, vector, keyword) and scores.get(top, EMPTY_FLOOR - 1) >= CONFIDENT_FLOOR:
        return Verdict("confident", _describe(database, ranked[:1]), CONFIDENT_FLOOR)
    return Verdict("ambiguous", _describe(database, ranked[:SHORTLIST]), CONFIDENT_FLOOR)


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
    """An OR bag rather than a phrase: a description shares no exact phrase with its document."""
    terms = terms_of(query)
    return " OR ".join(f'"{term}"' for term in terms) if terms else None


def _keyword_arm(
    database: sqlite3.Connection, query: str, scope: str | None
) -> tuple[list[int], list[int]]:
    """The arm, and the documents the query *names* — the only ones that lift it off the floor."""
    expression = _match_expression(query)
    if expression is None:
        return [], []
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
        SELECT documents.id, documents.path FROM name_fts
        JOIN documents ON documents.id = name_fts.rowid
        WHERE name_fts MATCH ? AND (? IS NULL OR documents.path LIKE ? || '/%')
        ORDER BY rank LIMIT ?
        """,
        (expression, scope, scope, NAME_POOL),
    ).fetchall()
    terms = terms_of(query)
    naming = [one for one, path in name_hits if _names_the_query(terms, path)]
    return _fuse(_first_seen(text_hits), _first_seen(name_hits)), naming


def _names_the_query(terms: list[str], path: str) -> bool:
    """How much of what was typed the name accounts for. `name_fts` holds the path's words."""
    wanted = set(terms)
    if not wanted:
        return False
    return len(wanted & set(words_of(path))) > len(wanted) * NAME_MATCH_MAJORITY


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


def _fuse(*arms: list[int]) -> list[int]:
    """Reciprocal rank fusion: the arms rank on incomparable scales, so only position is read."""
    scores: dict[int, float] = {}
    for arm in arms:
        for position, document_id in enumerate(arm):
            scores[document_id] = scores.get(document_id, 0.0) + 1.0 / (RRF_K + position + 1)
    return [document_id for document_id, _ in sorted(scores.items(), key=lambda pair: -pair[1])]


def _describe(database: sqlite3.Connection, document_ids: list[int]) -> tuple[Candidate, ...]:
    placeholders = ",".join("?" * len(document_ids))
    rows = database.execute(
        f"SELECT id, path, name, extracted FROM documents WHERE id IN ({placeholders})",
        document_ids,
    ).fetchall()
    by_id = {row[0]: Candidate(row[1], row[2], bool(row[3])) for row in rows}
    return tuple(by_id[one] for one in document_ids if one in by_id)
