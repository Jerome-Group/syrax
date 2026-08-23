"""Turning a hand-written list of queries into entries the report can score.

The fixture half of the benchmark set is written by a person and has to end up holding what a
captured miss holds: the verdict and the scores as they stood. Those cannot be typed — they belong
to an index — so this runs each query and records what came back, which is the same measurement
`capture` takes and the same one a rebuilt index destroys (ADR-0007).

A seeded entry carries **no failure shape**. It is a query kept so a change that breaks it is
visible, not a miss somebody marked, and the five shapes are the vocabulary of the second thing.
Which of these queries the index currently fails is the report's `first` and `found`, computed
fresh; writing today's failures into the entries would freeze them there.

The source names documents by *fragments of their path* rather than absolute paths, because a
person writing the list knows the chapter and not the mount point — and because one chapter is
three documents here, so a fragment is how an expectation names all of them at once.
"""

from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import dataclass, field

from .benchmark import FIXTURE, Entry, append, entries
from .config import SearchConfig
from .embedder import Embedder
from .index import open_index
from .retrieval import search


@dataclass
class SeedReport:
    """What went in, and everything that did not — a silent skip would be a bar nobody has."""

    seeded: int = 0
    refused: list[tuple[str, str]] = field(default_factory=list)
    """The query, and the fragment of it that named no document the index holds."""
    already: list[str] = field(default_factory=list)
    """Queries the set already held: it accretes and is never rewritten, so the guard is here."""

    def as_reply(self) -> dict:
        return {
            "seeded": self.seeded,
            "refused": [{"query": one, "fragment": fragment} for one, fragment in self.refused],
            "already": self.already,
        }


def seed(config: SearchConfig, embedder: Embedder, source_path: str) -> SeedReport:
    report = SeedReport()
    held = {one.query for one in entries(config.benchmark_path)}
    database = open_index(config.database_path)
    try:
        for wanted in _read(source_path):
            _seed_one(config, embedder, database, wanted, held, report)
    finally:
        database.close()
    return report


def _seed_one(
    config: SearchConfig,
    embedder: Embedder,
    database: sqlite3.Connection,
    wanted: dict,
    held: set[str],
    report: SeedReport,
) -> None:
    query = str(wanted.get("query", "")).strip()
    if not query:
        return
    if query in held:
        report.already.append(query)
        return

    expect: list[str] = []
    for fragment in wanted.get("expect") or []:
        found = _resolve(database, str(fragment))
        if not found:
            report.refused.append((query, str(fragment)))
            return
        expect.extend(one for one in found if one not in expect)

    scope = config.scopes.get(str(wanted["scope"])) if wanted.get("scope") else None
    verdict = search(database, query, embedder.embed_query(query), scope)
    append(
        config.benchmark_path,
        Entry(
            query=query,
            shape=None,
            verdict=verdict.state,
            floor=verdict.floor,
            scores=dict(verdict.scores),
            best=verdict.best,
            origin=FIXTURE,
            scope=scope,
            expect=tuple(expect),
            expects_nothing=bool(wanted.get("nothing")),
        ),
    )
    held.add(query)
    report.seeded += 1


def _resolve(database: sqlite3.Connection, fragment: str) -> list[str]:
    """Every document whose path carries this fragment — how one name reaches three files."""
    rows = database.execute(
        "SELECT path FROM documents WHERE path LIKE ? ORDER BY path", (f"%{fragment}%",)
    ).fetchall()
    return [row[0] for row in rows]


def _read(path: str) -> list[dict]:
    if not os.path.exists(path):
        raise FileNotFoundError(f"no list of queries at {path}")
    with open(path, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]
