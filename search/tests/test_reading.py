"""`read` reaches outside the index and stops at the blocklist, and holds nothing on disk."""

from __future__ import annotations

import os

from syrax_search.building import INCREMENTAL, run_pass
from syrax_search.index import open_index
from syrax_search.reading import Reader


def reader(machine, embedder) -> Reader:
    run_pass(machine, embedder, INCREMENTAL)
    return Reader(machine, open_index(machine.database_path))


def test_an_indexed_document_is_served_from_the_index(machine, embedder, tmp_path):
    reply = reader(machine, embedder).read(str(tmp_path / "documents" / "notes" / "rowing.md"))
    assert reply["read"] == "ok"
    assert reply["source"] == "index"
    assert "erg splits" in reply["text"]


def test_a_document_the_index_never_reached_is_read_anyway(machine, embedder, tmp_path):
    """The allowlist is a compute budget, so `read` is not bounded by it — only the blocklist is."""
    reply = reader(machine, embedder).read(str(tmp_path / "outside" / "letter.md"))
    assert reply["read"] == "ok"
    assert reply["source"] == "ephemeral"


def test_the_blocklist_refuses_and_says_why(machine, embedder, tmp_path):
    reply = reader(machine, embedder).read(str(tmp_path / "private" / "diary.md"))
    assert reply["read"] == "refused"
    assert "blocklist" in reply["reason"]


def test_a_dotfile_is_refused_wherever_it_is(machine, embedder, tmp_path):
    secret = tmp_path / ".env"
    secret.write_text("TOKEN=live")
    assert reader(machine, embedder).read(str(secret))["read"] == "refused"


def test_a_symlink_is_refused_rather_than_followed(machine, embedder, tmp_path):
    link = tmp_path / "shortcut.md"
    os.symlink(str(tmp_path / "private" / "diary.md"), link)
    assert reader(machine, embedder).read(str(link))["read"] == "refused"


def test_an_ephemeral_read_is_held_in_memory_and_swept(machine, embedder, tmp_path):
    holding = reader(machine, embedder)
    holding.read(str(tmp_path / "outside" / "letter.md"))
    assert holding.sweep(now=float("inf")) == 1
    assert holding.sweep(now=float("inf")) == 0
    assert not any(name.endswith(".txt") for name in os.listdir(machine.index_root))
