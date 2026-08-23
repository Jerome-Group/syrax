"""The retrieval report: how the index is scoring, and what the confident floor would be re-fitted.

Everything here computes and nothing here applies. Re-running the benchmark unasked is reporting;
computing what the floor *would* be is reporting; writing that number into configuration is a
person's act with a pull request behind it — and that line is what separates this loop from a
runtime that tunes itself (ADR-0007). `CONFIDENT_FLOOR` is a constant in `retrieval.py` and no code
path in this file can reach it.

The report is written to a file on every run and read back by the next one, which is how it can say
whether a number *moved*. That is the whole of what decides an unprompted post: a report that says
the same thing every time trains the Owner to ignore it.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime

from .benchmark import Entry, by_shape, counts, entries
from .config import SearchConfig
from .embedder import Embedder
from .index import open_index
from .retrieval import CONFIDENT_FLOOR, Verdict, search

# The gap the pinned floor was fitted by: 0.12 sits 0.003 above the best wrong answer on the trial's
# fifteen queries. The method is reproduced rather than replaced, so the re-fitted number and the
# pinned one are comparable — a second method would make the report's own headline incomparable
# with the constant it sits beside.
FITTING_MARGIN = 0.003


@dataclass(frozen=True)
class RetrievalReport:
    """One scoring run: the counts, the window the floor sits in, and what moved since the last."""

    numbers: dict[str, float | int | None]
    shapes: dict[str, int]
    pending_queries: list[str]
    best_wrong: float | None
    """The highest score a wrong top answer reached — the number the floor has to clear."""
    worst_right: float | None
    """The lowest a correct one reached. A re-fitted floor above it costs correct answers."""
    failed: str | None = None
    moved: tuple[str, ...] = ()
    scored_at: str = ""

    @property
    def is_worth_posting(self) -> bool:
        """Exceptions-only: a number moved, or the run did not finish."""
        return bool(self.moved) or self.failed is not None

    def as_reply(self) -> dict:
        return {
            "scored_at": self.scored_at or _now(),
            "numbers": self.numbers,
            "confident_floor": {
                "pinned": CONFIDENT_FLOOR,
                "refitted": self.numbers.get("refitted_confident_floor"),
                "best_wrong": self.best_wrong,
                "worst_right": self.worst_right,
                "applied": False,
            },
            "shapes": self.shapes,
            "pending_queries": self.pending_queries,
            "failed": self.failed,
            "moved": list(self.moved),
        }


def run(config: SearchConfig, embedder: Embedder) -> RetrievalReport:
    """Score the set against the index as it stands, say what moved, and write the report."""
    previous = _previous(config.retrieval_report_path)
    try:
        report = _score(config, embedder)
    except Exception as failure:
        # A run that could not finish is a reported outcome rather than a crash: the previous
        # numbers stand, and the failure is the thing that gets posted.
        report = _failed(previous, f"{type(failure).__name__}: {failure}")
    else:
        report = replace(report, moved=_moved(report.numbers, previous))
    _write(config.retrieval_report_path, report)
    return report


@dataclass
class _Tally:
    """What the scored half of the set says: how often the answer came back, and where it landed."""

    found: int = 0
    first: int = 0
    right: list[float] = field(default_factory=list)
    wrong: list[float] = field(default_factory=list)

    def add(self, entry: Entry, verdict: Verdict) -> None:
        paths = [one.path for one in verdict.candidates]
        self.found += 1 if entry.is_answered_by(paths) else 0
        self.first += 1 if entry.is_led_by(paths) else 0
        # Only the top document's own score is fitted against, because that is the one the floor is
        # read against. A query the index now answers with nothing has no score to fit either way,
        # and neither has one whose right answer *is* nothing: there is no document for the floor to
        # have been read about, so it belongs to neither distribution.
        top = paths[0] if paths else None
        if entry.expects_nothing or top is None or top not in verdict.scores:
            return
        (self.right if entry.is_led_by(paths) else self.wrong).append(verdict.scores[top])


def _score(config: SearchConfig, embedder: Embedder) -> RetrievalReport:
    database = open_index(config.database_path)
    try:
        set_entries = entries(config.benchmark_path)
        scorable = [one for one in set_entries if one.is_scorable]
        tally = _Tally()
        for entry in scorable:
            vector = embedder.embed_query(entry.query)
            tally.add(entry, search(database, entry.query, vector, entry.scope))
    finally:
        database.close()

    best_wrong = max(tally.wrong, default=None)
    return RetrievalReport(
        numbers={
            "scored": len(scorable),
            "found": tally.found,
            "first": tally.first,
            **counts(set_entries),
            "refitted_confident_floor": _refitted(best_wrong),
        },
        shapes=by_shape(set_entries),
        pending_queries=[one.query for one in set_entries if one.is_pending and not one.retired],
        best_wrong=best_wrong,
        worst_right=min(tally.right, default=None),
    )


def _refitted(best_wrong: float | None) -> float | None:
    """What the floor would be, stated and never written. Absent where nothing was fitted."""
    return None if best_wrong is None else round(best_wrong + FITTING_MARGIN, 3)


def _moved(numbers: dict, previous: dict | None) -> tuple[str, ...]:
    if previous is None:
        return ("first report",)
    before = previous.get("numbers", {})
    return tuple(name for name, value in numbers.items() if before.get(name) != value)


def _failed(previous: dict | None, reason: str) -> RetrievalReport:
    before = (previous or {}).get("numbers", {})
    return RetrievalReport(
        numbers=before,
        shapes=(previous or {}).get("shapes", {}),
        pending_queries=(previous or {}).get("pending_queries", []),
        best_wrong=(previous or {}).get("confident_floor", {}).get("best_wrong"),
        worst_right=(previous or {}).get("confident_floor", {}).get("worst_right"),
        failed=reason,
    )


def _previous(path: str) -> dict | None:
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except json.JSONDecodeError:
        return None


def _write(path: str, report: RetrievalReport) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(report.as_reply(), handle, indent=2)
        handle.write("\n")


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")
