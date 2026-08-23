"""The one set of queries the index is scored against, and the five shapes a miss comes in.

One file with two halves rather than two files: the hand-written entries the embedder trial left
and the misses captured from live use, each marked with which it is. Two files would mean two bars
and a standing argument about which is authoritative (ADR-0007).

The format is the hard-to-reverse part of this loop. An entry cannot be regenerated — the index
that produced its scores no longer exists — so the fields a capture must hold are fixed here and
changing them later means migrating real measurements or discarding them.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

FIXTURE = "fixture"
LIVE = "live"

Shape = Literal[
    "confident-and-wrong",
    "not-in-the-shortlist",
    "buried-in-the-shortlist",
    "empty-over-an-answer",
    "wrong-granularity",
]


@dataclass(frozen=True)
class Failure:
    """One shape of miss and the knob that fixes it, which is why the five are told apart at all.

    Recording only *wrong* would flatten five failures with three different fixes into one word and
    aim the next change at whichever knob came to mind (ADR-0007).
    """

    shape: Shape
    what: str
    fixed_by: str


FAILURES: tuple[Failure, ...] = (
    Failure("confident-and-wrong", "one document was sent, and it was not the answer", "the floor"),
    Failure(
        "not-in-the-shortlist",
        "the shortlist did not contain the answer at all",
        "retrieval breadth",
    ),
    Failure(
        "buried-in-the-shortlist",
        "the answer was offered, below documents that were not it",
        "the ranking",
    ),
    Failure(
        "empty-over-an-answer",
        "nothing was offered over a corpus that holds the answer",
        "the empty floor",
    ),
    Failure(
        "wrong-granularity",
        "the right subject at the wrong size: the textbook rather than its chapter",
        "the chunking",
    ),
)

SHAPES: tuple[Shape, ...] = tuple(one.shape for one in FAILURES)


def is_a_shape(value: str) -> bool:
    return value in SHAPES


@dataclass(frozen=True)
class Entry:
    """One query the index is scored against, and everything a rebuilt index would destroy.

    `verdict`, `floor`, `scores` and `best` are mandatory because they are the only fields that
    cannot be recovered later: without them there is no telling *search got worse* from *search was
    always like this*. `expect` is optional and the entry is pending without one — demanding it
    turns one gesture into an interrogation at the moment the Owner is already annoyed.
    """

    query: str
    shape: Shape
    verdict: str
    floor: float
    scores: dict[str, float]
    best: float | None
    origin: str = LIVE
    scope: str | None = None
    expect: str | None = None
    retired: bool = False
    captured_at: str = ""

    @property
    def is_pending(self) -> bool:
        """No correct path yet. *This document must not come first* is still a real assertion."""
        return self.expect is None

    @property
    def is_scorable(self) -> bool:
        return not self.retired and not self.is_pending

    def as_json(self) -> dict:
        return {
            "captured_at": self.captured_at or _now(),
            "origin": self.origin,
            "shape": self.shape,
            "query": self.query,
            "scope": self.scope,
            "verdict": self.verdict,
            "floor": self.floor,
            "scores": self.scores,
            "best": self.best,
            "expect": self.expect,
            "retired": self.retired,
        }


def append(path: str, entry: Entry) -> Entry:
    """One line, flushed: the set accretes measurements no re-run can reproduce."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    written = entry.as_json()
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(written) + "\n")
    return entry


def entries(path: str) -> list[Entry]:
    """The whole set. A line that will not parse is skipped rather than failing the run.

    An entry the Owner decides was a bad test is retired by marking, never deleted, so the
    judgement survives its subject — which is why nothing here rewrites the file.
    """
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as handle:
        return [one for one in (_read(line) for line in handle) if one is not None]


def counts(set_entries: list[Entry]) -> dict[str, int]:
    """The provenance that makes a re-fitted floor legible, and never a bare total.

    A set that grows by capturing failures becomes a set of hard queries, so a floor re-fitted on it
    drifts conservative by construction — not because retrieval got worse. A reader who sees the
    number rise without these counts beside it draws exactly the wrong conclusion (ADR-0007).
    """
    live = [one for one in set_entries if one.origin == LIVE]
    return {
        "total": len(set_entries),
        "fixture": len(set_entries) - len(live),
        "live": len(live),
        "pending": len([one for one in set_entries if one.is_pending and not one.retired]),
        "retired": len([one for one in set_entries if one.retired]),
    }


def by_shape(set_entries: list[Entry]) -> dict[str, int]:
    """What is failing, in the vocabulary the fix is chosen from."""
    counted = {shape: 0 for shape in SHAPES}
    for one in set_entries:
        if not one.retired:
            counted[one.shape] = counted[one.shape] + 1
    return counted


def _read(line: str) -> Entry | None:
    try:
        source = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(source, dict) or not is_a_shape(str(source.get("shape"))):
        return None
    try:
        return _entry(source)
    except TypeError, ValueError:
        # The fixture half is written by hand, and one line the Owner mistyped is one entry lost
        # rather than a scoring run that will not start.
        return None


def _entry(source: dict) -> Entry:
    return Entry(
        query=str(source.get("query", "")),
        shape=source["shape"],
        verdict=str(source.get("verdict", "")),
        floor=float(source.get("floor", 0.0)),
        scores={str(path): float(score) for path, score in (source.get("scores") or {}).items()},
        best=None if source.get("best") is None else float(source["best"]),
        origin=LIVE if source.get("origin") == LIVE else FIXTURE,
        scope=source.get("scope"),
        expect=source.get("expect"),
        retired=bool(source.get("retired")),
        captured_at=str(source.get("captured_at", "")),
    )


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")
