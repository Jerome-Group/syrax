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

# What the Owner says when none of the ten was what they meant. Zero rather than a word, because
# `choose` takes the number they said and a list numbered from one has no zeroth line — so it is
# unambiguous without a second parameter, and a model cannot spell it by accident from a digit.
DECLINE = 0


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
        """The verdict as the chat gets it: a numbered candidate per line on a close call.

        A verdict that is not a close call passes through untouched. `confident` sends its document
        without asking and `empty` has nothing to send, so neither has anything to choose between.

        It is held against the answer's own token rather than one minted here, so the number the
        Owner says and a reply about the same search are the same event to the capture that reads
        them (ADR-0007). One token reaches the chat where ten used to, and the model never composes
        one: a shortlist of ten buttons was a tool call two models could not emit (ADR-0033).
        """
        if not verdict.is_a_close_call:
            return verdict.as_reply()

        self._offered[token] = _Offered(
            verdict.candidates, scope, time.monotonic() + self._lifetime_seconds
        )
        return verdict.as_reply(numbered=True)

    def resolve(self, answer: str, position: int, scope: str | None = None) -> dict:
        """What the number the Owner said stands for: one document, none of them, or nothing left.

        `scope` is the connection's, not the model's, so a shortlist offered to one chat cannot be
        resolved through another's — the boundary the scope draws over `search` holds over the
        answers that come back from it.

        A number outside the list is `expired` rather than an error, for the same reason a stale
        token was: what it means is *that shortlist is not what you are answering*, and the reply
        the chat gives for it — say so and offer to search again — is right either way.

        **Anything that is not a whole number is that too, rather than a raised exception.** The
        position now comes from a model reading a digit out of the Owner's own message, which is
        the class of mistake this whole shape exists to tolerate: `"3"` arriving where `3` was
        declared is exactly the confusion that made the old shortlist unemittable, and `expired` is
        a reply the chat knows how to say where a `TypeError` is not.
        """
        offered = self._offered.get(answer)
        if offered is None or offered.expires_at <= time.monotonic() or offered.scope != scope:
            return {"choice": "expired"}
        if not isinstance(position, int) or isinstance(position, bool):
            return {"choice": "expired"}
        if position == DECLINE:
            return {"choice": "declined"}
        if not 1 <= position <= len(offered.candidates):
            return {"choice": "expired"}
        return {"choice": "chosen", "result": offered.candidates[position - 1].as_result()}

    def sweep(self, now: float | None = None) -> int:
        """Forget what has aged out, on the same beat the reader and the embedder are swept on."""
        moment = time.monotonic() if now is None else now
        expired = [token for token, one in self._offered.items() if one.expires_at <= moment]
        for token in expired:
            del self._offered[token]
        return len(expired)
