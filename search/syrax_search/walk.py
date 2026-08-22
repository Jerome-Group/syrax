"""The crawl, which never follows a symlink and applies the three lists as it goes.

Symlinks are not a detail on this machine: `~/Google Drive` points at the same tree as
`/Volumes/RAID0/My Drive`, so a following walk turns one root into two and a folder of seventeen
files into 56,134 (ADR-0004). `os.walk(followlinks=False)` alone is not enough — it declines to
descend into a linked *directory* and still reports linked *files* — so both are refused here.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from dataclasses import dataclass

from .lists import Lists


@dataclass(frozen=True)
class Candidate:
    path: str
    name: str
    size: int
    mtime: float
    """False where the document is indexed by its name alone: outside the extraction scope."""
    extracted: bool


def crawl(lists: Lists) -> Iterator[Candidate]:
    """Every file the index allowlist reaches that the blocklist does not forbid."""
    for root in lists.index_allowlist:
        if lists.blocks(root) or os.path.islink(root) or not os.path.isdir(root):
            continue
        yield from _crawl_root(root, lists)


def _crawl_root(root: str, lists: Lists) -> Iterator[Candidate]:
    for directory, subdirectories, filenames in os.walk(root, followlinks=False):
        subdirectories[:] = [
            name
            for name in subdirectories
            if not os.path.islink(os.path.join(directory, name))
            and lists.blocks(os.path.join(directory, name)) is None
        ]
        for name in filenames:
            path = os.path.join(directory, name)
            if os.path.islink(path) or lists.blocks(path) is not None:
                continue
            try:
                stat = os.stat(path, follow_symlinks=False)
            except OSError:
                continue
            yield Candidate(
                path=path,
                name=name,
                size=stat.st_size,
                mtime=stat.st_mtime,
                extracted=lists.extracts(path),
            )
