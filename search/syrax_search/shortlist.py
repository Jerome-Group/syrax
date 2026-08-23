"""The shortlist a close call offers, and the tap that comes back for it.

A button carries a token rather than a path, and this unit is the only thing that can turn one back
into a document — ADR-0026 argues why, and why every way a tap can fail to resolve is folded into
the single answer `expired`.

Held in memory rather than written down, for the reason the reader's extracted text is: nothing has
to decide when deleting it is safe, and a restart purges by construction.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from .retrieval import Candidate, Verdict

# Long enough that looking away does not lose the question, short enough that a tap on a
# scrolled-back message is refused rather than answered. What the ceiling defends against is a
# shortlist the Owner has forgotten asking for arriving as a file they did not ask for.
LIFETIME_SECONDS = 15 * 60

DECLINE = "none"


def token_of(choice: str) -> str:
    """The answer a tap belongs to. The value is composed here, so it is read back here."""
    return choice.rpartition(":")[0]


@dataclass(frozen=True)
class _Offered:
    candidates: tuple[Candidate, ...]
    scope: str | None
    expires_at: float


class Shortlists:
    """Every close call this process has offered and not yet forgotten."""

    def __init__(self, lifetime_seconds: int = LIFETIME_SECONDS) -> None:
        self._lifetime_seconds = lifetime_seconds
        self._offered: dict[str, _Offered] = {}

    def offer(self, verdict: Verdict, scope: str | None, token: str) -> dict:
        """The verdict as the chat gets it: a tappable value per candidate on a close call.

        A verdict that is not a close call passes through untouched. `confident` sends its document
        without asking and `empty` has nothing to send, so neither has anything to choose between.

        The token is the answer's own rather than one minted here, so a tap and a reply about the
        same search are the same event to the capture that reads them (ADR-0007).
        """
        if not verdict.is_a_close_call:
            return verdict.as_reply()

        self._offered[token] = _Offered(
            verdict.candidates, scope, time.monotonic() + self._lifetime_seconds
        )
        choices = [f"{token}:{position}" for position in range(len(verdict.candidates))]
        return verdict.as_reply(choices) | {"none_of_these": f"{token}:{DECLINE}"}

    def resolve(self, choice: str, scope: str | None = None) -> dict:
        """What a tap stands for: one document, the Owner declining all of them, or nothing left.

        `scope` is the connection's, not the model's, so a shortlist offered to one chat cannot be
        resolved through another's — the boundary the scope draws over `search` holds over the taps
        that come back from it.
        """
        offered = self._offered.get(token_of(choice))
        position = choice.rpartition(":")[2]
        if offered is None or offered.expires_at <= time.monotonic() or offered.scope != scope:
            return {"choice": "expired"}
        if position == DECLINE:
            return {"choice": "declined"}
        if not position.isdigit() or int(position) >= len(offered.candidates):
            return {"choice": "expired"}
        return {"choice": "chosen", "result": offered.candidates[int(position)].as_result()}

    def sweep(self, now: float | None = None) -> int:
        """Forget what has aged out, on the same beat the reader and the embedder are swept on."""
        moment = time.monotonic() if now is None else now
        expired = [token for token, one in self._offered.items() if one.expires_at <= moment]
        for token in expired:
            del self._offered[token]
        return len(expired)
