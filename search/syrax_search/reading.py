"""`read`: the text of one named document, bounded by the blocklist and by nothing else.

The index allowlist does not bound this, deliberately. It is a compute budget rather than a fence
(ADR-0004), so `read` reaches anywhere on the machine the blocklist does not forbid — and the price
is stated rather than discovered: **a new private tree becomes readable the moment it exists unless
a blocklist pattern already covers it.** That is what makes the blocklist a living list.

A document the index does not hold is extracted for the request and held in memory under an idle
TTL — never written down, so nothing has to decide when deleting it is safe, and a crash purges by
construction.
"""

from __future__ import annotations

import os
import sqlite3
import time
from dataclasses import dataclass

from .config import SearchConfig
from .extraction import extract
from .index import document_text

# A forty-page PDF is not a reply. What a model needs is enough of the document to answer from,
# and the rest is a second `read` away.
MAXIMUM_REPLY_CHARACTERS = 200_000


@dataclass
class _Held:
    text: str
    expires_at: float


class Reader:
    def __init__(self, config: SearchConfig, database: sqlite3.Connection) -> None:
        self._config = config
        self._database = database
        self._held: dict[str, _Held] = {}

    def read(self, path: str) -> dict:
        absolute = os.path.abspath(os.path.expanduser(path))
        blocked = self._config.lists.blocks(absolute)
        if blocked is not None:
            return {"read": "refused", "path": absolute, "reason": blocked}
        if os.path.islink(absolute):
            return {
                "read": "refused",
                "path": absolute,
                "reason": "symlink: what it points at is read by its own path or not at all",
            }
        if not os.path.isfile(absolute):
            return {"read": "refused", "path": absolute, "reason": "not a file"}

        stored = document_text(self._database, absolute)
        if stored:
            return self._reply(absolute, stored, "index")

        held = self._recall(absolute)
        if held is not None:
            return self._reply(absolute, held, "ephemeral")

        extracted = extract(absolute)
        if extracted.text is None:
            return {"read": "refused", "path": absolute, "reason": extracted.status}
        self._hold(absolute, extracted.text)
        return self._reply(absolute, extracted.text, "ephemeral")

    def sweep(self, now: float | None = None) -> int:
        """Drop what nobody has re-read. Called on the same beat as the embedder's eviction."""
        moment = time.monotonic() if now is None else now
        expired = [path for path, held in self._held.items() if held.expires_at <= moment]
        for path in expired:
            del self._held[path]
        return len(expired)

    def _recall(self, path: str) -> str | None:
        held = self._held.get(path)
        if held is None or held.expires_at <= time.monotonic():
            return None
        self._hold(path, held.text)
        return held.text

    def _hold(self, path: str, text: str) -> None:
        self._held[path] = _Held(text, time.monotonic() + self._config.idle_evict_seconds)

    def _reply(self, path: str, text: str, source: str) -> dict:
        return {
            "read": "ok",
            "path": path,
            "source": source,
            "truncated": len(text) > MAXIMUM_REPLY_CHARACTERS,
            "text": text[:MAXIMUM_REPLY_CHARACTERS],
        }
