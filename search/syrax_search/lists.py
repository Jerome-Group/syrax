"""The three lists ADR-0004 separates, and the one of them that is a boundary.

They are not three names for one thing. The **index allowlist** is a compute scope — the roots
worth crawling on this machine. The **extraction scope** is the subset whose documents are opened
and read rather than indexed by name alone. The **blocklist** is the only boundary of the three:
it applies everywhere on the machine, including outside the allowlist, which is where `read`
reaches.

Every one of them is applied while walking, never while querying. A query-time filter is a filter
somebody can forget to pass; an index that never held the bytes cannot return them.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from fnmatch import fnmatch

# Placement rather than judgement: these are true of this machine's shape rather than of one
# deployment, so they are code and a deployment adds to them (ADR-0004 — the blocklist is living).
BLOCKED_NAMES = (
    "id_rsa",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    ".env",
    ".env.*",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "*.keychain",
    "*.keychain-db",
    "credentials",
    "credentials.json",
    "*.sparsebundle",
    "*.photoslibrary",
    "*.musiclibrary",
    "*.tvlibrary",
    "*.imovielibrary",
    "*.fcpbundle",
    "*.aplibrary",
)

BLOCKED_DIRECTORIES = (
    "node_modules",
    "site-packages",
    "vendor",
    "dist",
    "build",
    "target",
    "Pods",
    "claude-sessions",
    ".Backups.backupdb",
    "Google Chrome",
    "%2FUsers",
)


@dataclass(frozen=True)
class Lists:
    """One machine's three lists, each already resolved to absolute paths."""

    index_allowlist: tuple[str, ...]
    extraction_scope: tuple[str, ...]
    blocked_roots: tuple[str, ...]

    def blocks(self, path: str) -> str | None:
        """Why this path may never be touched, or `None` if nothing forbids it."""
        for root in self.blocked_roots:
            if is_within(path, root):
                return f"blocklist: under {root}"
        parts = path.split(os.sep)
        for part in parts[:-1]:
            if part.startswith(".") and part not in ("", "."):
                return f"blocklist: dot-directory {part}"
            if part in BLOCKED_DIRECTORIES:
                return f"blocklist: {part}"
        name = parts[-1]
        if name.startswith("."):
            return "blocklist: dotfile"
        if name in BLOCKED_DIRECTORIES:
            return f"blocklist: {name}"
        for pattern in BLOCKED_NAMES:
            if fnmatch(name, pattern):
                return f"blocklist: {pattern}"
        return None

    def indexes(self, path: str) -> bool:
        return any(is_within(path, root) for root in self.index_allowlist)

    def extracts(self, path: str) -> bool:
        """Inside the extraction scope a document is read; outside it, only its name is indexed."""
        return any(is_within(path, root) for root in self.extraction_scope)


def is_within(path: str, root: str) -> bool:
    """Prefix containment on path components, so `/a/bc` is not inside `/a/b`."""
    return path == root or path.startswith(root.rstrip(os.sep) + os.sep)
