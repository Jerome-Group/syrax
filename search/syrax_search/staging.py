"""`attach`: one document put where the chat can send it from, and nowhere else.

The runtime uploads a local file only from roots it owns, and the Owner's corpus is under none of
them. **ADR-0026 is why the answer is a copy rather than a wider reach**, and it is worth reading
before changing anything here: the alternative costs the blocklist its meaning.

A handover is a directory of its own, so two documents called *notes.pdf* do not collide and the
sweep drops a whole one at a time.
"""

from __future__ import annotations

import os
import shutil
import time
from dataclasses import dataclass

from .config import SearchConfig
from .reading import absolute_path, refused


@dataclass(frozen=True)
class _Staged:
    directory: str
    expires_at: float


class Staging:
    def __init__(self, config: SearchConfig) -> None:
        self._config = config
        self._staged: list[_Staged] = []
        self._handovers = 0

    def attach(self, path: str) -> dict:
        absolute = absolute_path(path)
        refusal = refused(self._config, absolute)
        if refusal is not None:
            return {"attach": "refused", **refusal}

        self._handovers += 1
        directory = os.path.join(self._config.staging_root, str(self._handovers))
        # Private, and rebuilt rather than reused: a handover holds the Owner's own documents, and
        # the same number comes round again after a restart.
        shutil.rmtree(directory, ignore_errors=True)
        os.makedirs(directory, mode=0o700, exist_ok=True)
        staged = os.path.join(directory, os.path.basename(absolute))
        _place(absolute, staged)
        self._staged.append(_Staged(directory, time.monotonic() + self._config.idle_evict_seconds))
        return {"attach": "ok", "path": staged, "name": os.path.basename(absolute)}

    def sweep(self, now: float | None = None) -> int:
        moment = time.monotonic() if now is None else now
        expired = [one for one in self._staged if one.expires_at <= moment]
        for one in expired:
            shutil.rmtree(one.directory, ignore_errors=True)
            self._staged.remove(one)
        return len(expired)


def _place(original: str, staged: str) -> None:
    """A link where the two sit on one volume, and a copy where they do not — a document can be
    hundreds of megabytes, and the link costs nothing while the copy costs all of it."""
    try:
        os.link(original, staged)
    except OSError:
        shutil.copyfile(original, staged)
