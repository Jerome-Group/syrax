"""What the Owner is replying to when they say a result was wrong, and the entry that comes of it.

Capture is explicit: the gesture is a reply to the offending result or a tap on *none of these*, and
nothing infers a miss from how the next message reads (ADR-0007). A model does parse the reply —
that is ordinary tool-calling — but it never supplies the numbers. The verdict and the scores are
taken from the answer the Owner is pointing at, which this unit is the only thing holding, so a
capture is a measurement rather than a model's recollection of one.

Held in memory for the same reason the reader's extracted text is: nothing has to decide when
deleting it is safe, and a restart purges by construction. An answer nobody remembers is refused
rather than reconstructed — a re-run would record what the index says today under the date the
Owner complained, which is the one thing the mandatory fields exist to prevent.
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass

from .benchmark import LIVE, Entry, Shape, append, is_a_shape
from .retrieval import Verdict

# Long enough that a reply written after lunch still lands, short enough that a day's answers are
# not held for a week. The gesture is a reply to a message, and Telegram will let the Owner make one
# long after that: past this, the miss is refused rather than recorded with today's numbers.
LIFETIME_SECONDS = 24 * 60 * 60


@dataclass(frozen=True)
class Answer:
    """One search as it was answered: the token it is pointed at by, and everything it scored."""

    token: str
    query: str
    scope: str | None
    verdict: Verdict


@dataclass
class _Remembered:
    answer: Answer
    expires_at: float
    captured: Shape | None = None


class Answers:
    """Every search this process has answered and not yet forgotten, and the misses taken from them.

    One answer captures once. The Owner rejecting a shortlist and then saying so in words is one
    miss arriving twice, and a set that counted it twice would weight it twice.
    """

    def __init__(self, set_path: str, lifetime_seconds: int = LIFETIME_SECONDS) -> None:
        self._set_path = set_path
        self._lifetime_seconds = lifetime_seconds
        self._remembered: dict[str, _Remembered] = {}

    def remember(self, query: str, scope: str | None, verdict: Verdict) -> Answer:
        answer = Answer(secrets.token_urlsafe(6), query, scope, verdict)
        self._remembered[answer.token] = _Remembered(
            answer, time.monotonic() + self._lifetime_seconds
        )
        return answer

    def capture(self, token: str, shape: str, expect: str | None = None) -> dict:
        """Record one miss against the answer it was made about, or say why nothing was recorded."""
        remembered = self._remembered.get(token)
        if remembered is None or remembered.expires_at <= time.monotonic():
            return {"captured": "expired"}
        if remembered.captured is not None:
            return {"captured": "already", "shape": remembered.captured}
        if not is_a_shape(shape):
            return {"captured": "refused", "reason": "that is not one of the five shapes"}
        if expect is not None and not expect.startswith("/"):
            return {"captured": "refused", "reason": "a correct path is an absolute path"}

        entry = append(self._set_path, _entry_of(remembered.answer, shape, expect))
        remembered.captured = entry.shape
        return {"captured": entry.shape, "pending": entry.is_pending}

    def sweep(self, now: float | None = None) -> int:
        """Forget what has aged out, on the same beat the reader and the shortlists are swept on."""
        moment = time.monotonic() if now is None else now
        expired = [token for token, one in self._remembered.items() if one.expires_at <= moment]
        for token in expired:
            del self._remembered[token]
        return len(expired)


def _entry_of(answer: Answer, shape: Shape, expect: str | None) -> Entry:
    """A captured miss names at most one correct document: the Owner points at one, in a reply."""
    return Entry(
        query=answer.query,
        shape=shape,
        verdict=answer.verdict.state,
        floor=answer.verdict.floor,
        scores=dict(answer.verdict.scores),
        best=answer.verdict.best,
        origin=LIVE,
        scope=answer.scope,
        expect=() if expect is None else (expect,),
    )
