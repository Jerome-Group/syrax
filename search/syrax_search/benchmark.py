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
    shape: Shape | None
    """Which of the five this was, or `None` where the entry is not a miss at all.

    The fixture half is mostly queries the index already answers, kept so a change that breaks one
    is visible. Naming a failure shape on those to satisfy the field would put misses nobody had
    into the counts the next fix is chosen from. A *captured* miss always has one — `capture`
    refuses anything outside the five — and this is the hand-written half's licence, not its.
    """
    verdict: str
    floor: float
    scores: dict[str, float]
    best: float | None
    origin: str = LIVE
    scope: str | None = None
    expect: tuple[str, ...] = ()
    """Every document that answers this query. One chapter is three of them here — its source, its
    render and the textbook's copy — and any one of them coming first is the query answered."""
    expects_nothing: bool = False
    """The right answer is *nothing here*, which is an assertion and not the absence of one."""
    retired: bool = False
    captured_at: str = ""

    @property
    def is_pending(self) -> bool:
        """Nothing is asserted yet. *Nothing here* is asserted, so it is not this."""
        return not self.expect and not self.expects_nothing

    @property
    def is_scorable(self) -> bool:
        return not self.retired and not self.is_pending

    def is_answered_by(self, paths: list[str]) -> bool:
        """Whether what came back holds the answer — which for some queries is coming back empty."""
        return not paths if self.expects_nothing else bool(set(paths) & set(self.expect))

    def is_led_by(self, paths: list[str]) -> bool:
        """Whether what came back *leads* with it. Nothing leads a reply that names nothing."""
        return not paths if self.expects_nothing else bool(paths) and paths[0] in self.expect

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
            "expect": list(self.expect),
            "expects_nothing": self.expects_nothing,
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
        if one.shape is not None and not one.retired:
            counted[one.shape] = counted[one.shape] + 1
    return counted


def _read(line: str) -> Entry | None:
    try:
        source = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(source, dict):
        return None
    if source.get("shape") is not None and not is_a_shape(str(source["shape"])):
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
        shape=source.get("shape"),
        verdict=str(source.get("verdict", "")),
        floor=float(source.get("floor", 0.0)),
        scores={str(path): float(score) for path, score in (source.get("scores") or {}).items()},
        best=None if source.get("best") is None else float(source["best"]),
        origin=LIVE if source.get("origin") == LIVE else FIXTURE,
        scope=source.get("scope"),
        expect=_expected(source.get("expect")),
        expects_nothing=bool(source.get("expects_nothing")),
        retired=bool(source.get("retired")),
        captured_at=str(source.get("captured_at", "")),
    )


def _expected(source: object) -> tuple[str, ...]:
    """One path or several. `capture` writes one, and the hand-written half may name a set."""
    if source is None:
        return ()
    if isinstance(source, str):
        return (source,)
    return tuple(str(one) for one in source)


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")
