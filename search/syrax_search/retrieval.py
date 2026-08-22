"""The two arms, their fusion, and the verdict the tool returns instead of results.

The thresholds live here rather than in a model's prompt, so they are numbers in one place that can
be tuned against real queries instead of prose a model may quietly reinterpret — and moving one is
a pull request, which is the line ADR-0007 draws between a loop that reports and a loop that
retunes itself.

Both floors are what survived #34's trial, and two conditions did not. `confident` originally
required an absolute floor **and** a margin over the runner-up **and** both arms agreeing; the
margin separated nothing, both-arms-agree fired falsely for the pinned model, and the floor's other
job — deciding *empty* — is the only one it does cleanly.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

import numpy as np

# Fitted rather than tuned: 0.12 sits 0.003 above the best wrong answer on a fifteen-query
# benchmark, which is a number chosen by that benchmark's smallest gap. It is safe in the direction
# that matters — being too cautious costs a shortlist, being too eager sends the wrong file — and
# it is the first thing a grown benchmark should revisit.
CONFIDENT_FLOOR = 0.12

# In a window from -0.292 to -0.172 that separates an unanswerable query from every correct answer.
EMPTY_FLOOR = -0.23

# Both floors are read against `1 - distance` from the vector arm, which is the expression the
# trial fitted them to. ADR-0004 calls that quantity a cosine and it is not one: a `vec0` table
# without `distance_metric` returns L2. The arithmetic is reproduced rather than reinterpreted, and
# ADR-0023 is why — declaring the metric cosine and keeping these two numbers would leave a floor
# nobody has measured against wearing the authority of a measurement made against something else.

RRF_K = 60
CANDIDATE_POOL = 40
NAME_POOL = 10
SHORTLIST = 3

# "and" and "for" survive a bare length filter and appear in every chunk, which is how
# "Dummit and Foote" ranked a poster's bibliography above the book itself.
STOP_WORDS = frozenset(
    [
        "the",
        "and",
        "for",
        "was",
        "what",
        "that",
        "with",
        "from",
        "this",
        "you",
        "your",
        "are",
        "how",
        "does",
        "did",
        "where",
        "which",
        "about",
        "into",
        "out",
        "who",
        "why",
        "when",
        "they",
        "them",
        "its",
        "has",
        "have",
        "had",
        "can",
        "could",
        "would",
        "should",
        "will",
        "shall",
        "may",
        "might",
        "must",
        "one",
        "two",
        "not",
        "but",
        "all",
        "any",
        "our",
        "his",
        "her",
        "their",
    ]
)


@dataclass(frozen=True)
class Candidate:
    path: str
    name: str
    """False where only the name is indexed: the document exists and was never read."""
    extracted: bool


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
            "floor_provenance": "fitted to a fifteen-query benchmark, provisional (ADR-0004)",
        }


def search(
    database: sqlite3.Connection, query: str, query_vector: np.ndarray, scope: str | None
) -> Verdict:
    keyword = _keyword_arm(database, query, scope)
    vector, scores = _vector_arm(database, query_vector, scope)
    ranked = _fuse(vector, keyword)
    if not ranked:
        return Verdict("empty", (), EMPTY_FLOOR)

    # The floor is a statement about the vector arm's judgement, so it decides `empty` only where
    # that judgement is all there was. A document held by name alone has no vector at all, and
    # *Dummit and Foote* is a correct answer at -0.17 because it wins on the keyword arm entirely —
    # a floor applied over a literal name match returns silence for exactly the queries that name
    # what they want (ADR-0004).
    best = max(scores.values(), default=EMPTY_FLOOR - 1)
    if best < EMPTY_FLOOR and not keyword:
        return Verdict("empty", (), EMPTY_FLOOR)

    top = ranked[0]
    if scores.get(top, EMPTY_FLOOR - 1) >= CONFIDENT_FLOOR:
        return Verdict("confident", _describe(database, ranked[:1]), CONFIDENT_FLOOR)
    return Verdict("ambiguous", _describe(database, ranked[:SHORTLIST]), CONFIDENT_FLOOR)


def terms_of(query: str) -> list[str]:
    words = "".join(c if c.isalnum() else " " for c in query).lower().split()
    return [word for word in words if len(word) > 2 and word not in STOP_WORDS]


def _match_expression(query: str) -> str | None:
    """An OR bag rather than a phrase: a description shares no exact phrase with its document."""
    terms = terms_of(query)
    return " OR ".join(f'"{term}"' for term in terms) if terms else None


def _keyword_arm(database: sqlite3.Connection, query: str, scope: str | None) -> list[int]:
    """Chunk text and document name, fused into the one arm they are two halves of."""
    expression = _match_expression(query)
    if expression is None:
        return []
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
        SELECT documents.id FROM name_fts
        JOIN documents ON documents.id = name_fts.rowid
        WHERE name_fts MATCH ? AND (? IS NULL OR documents.path LIKE ? || '/%')
        ORDER BY rank LIMIT ?
        """,
        (expression, scope, scope, NAME_POOL),
    ).fetchall()
    return _fuse(_first_seen(text_hits), _first_seen(name_hits))


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
