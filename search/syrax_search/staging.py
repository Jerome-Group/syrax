"""`attach`: one document put where the chat can send it from, and nowhere else.

The runtime uploads a local file only from a handful of roots it owns — its state directory, its
scratch root, the calling agent's workspace — and the Owner's corpus is under none of them. Measured
on `openclaw@2026.6.34`: any other path is refused outright with *local media path is not under an
allowed directory*, **unless** the agent's own tool policy carries a filesystem `read`, which turns
the allowlist into "wherever the source lives".

Widening it that way is the option this exists to avoid. It would hand a model a general file read
and the blocklist would stop being the boundary ADR-0004 makes it: the unit's own refusals would
guard `read` while the agent walked past them with the runtime's.

So the unit hands the document over instead. `attach` applies exactly `read`'s refusals and links —
or copies, across a device boundary — the document under a staging root inside the runtime's own
state, returning the staged path. The model never holds a filesystem: it holds one path this unit
chose, to one document this unit already agreed to open.

A staged name is a directory of its own, so two documents called *notes.pdf* do not collide and the
sweep can drop a whole handover at once. They are swept on the same beat as the reader's held text.
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
