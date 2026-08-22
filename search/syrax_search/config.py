"""What one machine supplies to the search unit, read from the same `deployment.json` the gateway's
installer reads.

Two units in two languages read one file rather than two, so a root can never be named twice and
drift. Each reads only the fields it uses and validates those, which is why there is no shared
schema to keep in step.

The floors are deliberately absent from here. They are constants in `retrieval.py` with their
provenance beside them, so moving one is a pull request rather than an edit to a machine-local
file — which is the line ADR-0007 exists to hold.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass

from .lists import Lists, is_within, literal_prefix

DEFAULT_PORT = 18790
DEFAULT_IDLE_EVICT_SECONDS = 1800

# The pinned export, in the layout `fetch-embedder` writes. Under the index root rather than in the
# checkout: it is 698 MB of weights, and placement is what keeps it out (ADR-0004).
EMBEDDER_DIRECTORY = "models/embeddinggemma-300m-onnx"


class InvalidDeployment(Exception):
    pass


@dataclass(frozen=True)
class SearchConfig:
    index_root: str
    embedder_root: str
    port: int
    idle_evict_seconds: int
    lists: Lists
    scopes: dict[str, str]
    """Named scopes an agent's MCP client is pointed at, never an argument the model supplies."""

    @property
    def database_path(self) -> str:
        return os.path.join(self.index_root, "index.sqlite")

    @property
    def failure_ledger_path(self) -> str:
        return os.path.join(self.index_root, "failures.jsonl")


def read_deployment(path: str) -> SearchConfig:
    with open(path, encoding="utf-8") as handle:
        source = json.load(handle)
    if not isinstance(source, dict):
        raise InvalidDeployment("A deployment is a JSON object.")

    index_root = _absolute(source, "searchIndex")
    allowlist = _roots(source, "indexAllowlist")
    scope = _entries(source, "extractionScope")
    outside = [
        entry for entry in scope if not any(is_within(literal_prefix(entry), a) for a in allowlist)
    ]
    if outside:
        raise InvalidDeployment(
            f"extractionScope names {outside[0]}, which no indexAllowlist root contains: "
            "the scope is a subset of the allowlist, not a second list of its own."
        )

    return SearchConfig(
        index_root=index_root,
        embedder_root=os.path.join(index_root, EMBEDDER_DIRECTORY),
        port=_port(source.get("searchPort")),
        idle_evict_seconds=DEFAULT_IDLE_EVICT_SECONDS,
        lists=Lists(
            index_allowlist=allowlist,
            extraction_scope=scope,
            blocked_roots=(*_roots(source, "blocklist"), *_always_blocked(index_root)),
        ),
        scopes=_scopes(source.get("searchScopes"), allowlist),
    )


def _always_blocked(index_root: str) -> tuple[str, ...]:
    """Two roots no deployment should have to remember, and one of them is this unit's own.

    Without the index root the index indexes itself: the extracted text of every private document
    sits in that file verbatim. `~/Library` is the machine's own state rather than the Owner's
    documents, and it holds the credential and session stores by construction.
    """
    return (index_root, os.path.join(os.path.expanduser("~"), "Library"))


def _scopes(value: object, allowlist: tuple[str, ...]) -> dict[str, str]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise InvalidDeployment("searchScopes maps a scope name to one root.")
    scopes = {}
    for name, root in value.items():
        if not isinstance(root, str) or not root.startswith("/"):
            raise InvalidDeployment(f"searchScopes.{name} must be an absolute path.")
        if not any(is_within(root, a) for a in allowlist):
            raise InvalidDeployment(
                f"searchScopes.{name} is outside the index allowlist, so it would scope to nothing."
            )
        scopes[name] = root.rstrip("/")
    return scopes


def _roots(source: dict, key: str) -> tuple[str, ...]:
    return _entries(source, key, "an absolute path")


def _entries(source: dict, key: str, shape: str = "an absolute path or pattern") -> tuple[str, ...]:
    value = source.get(key)
    if not isinstance(value, list) or not value:
        raise InvalidDeployment(f"{key} must be a non-empty list of {shape}s.")
    for entry in value:
        if not isinstance(entry, str) or not entry.startswith("/"):
            raise InvalidDeployment(f"{key} names {entry!r}, which is not {shape}.")
    return tuple(entry.rstrip("/") for entry in value)


def _absolute(source: dict, key: str) -> str:
    value = source.get(key)
    if not isinstance(value, str) or not value.startswith("/"):
        raise InvalidDeployment(f"{key} must be an absolute path.")
    return value.rstrip("/")


def _port(value: object) -> int:
    if value is None:
        return DEFAULT_PORT
    if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 65535:
        raise InvalidDeployment("searchPort must be a port number.")
    return value
