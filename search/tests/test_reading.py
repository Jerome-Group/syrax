"""`read` reaches outside the index and stops at the blocklist, and holds nothing on disk."""

from __future__ import annotations

import os

import pytest

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


@pytest.mark.parametrize("change", ["edit", "replace"])
def test_repeated_ephemeral_reads_reuse_text_until_the_source_changes(
    machine, tmp_path, monkeypatch, change
):
    import syrax_search.reading as reading

    holding = Reader(machine, open_index(machine.database_path))
    document = tmp_path / "outside" / "letter.md"
    original = reading.extract
    calls = []

    def observed(path):
        calls.append(path)
        return original(path)

    monkeypatch.setattr(reading, "extract", observed)
    first = holding.read(str(document))
    assert holding.read(str(document)) == first
    assert len(calls) == 1
    previous = document.stat()
    replacement = "updated external document contents ".ljust(previous.st_size, "x")
    if change == "edit":
        document.write_text(replacement)
    else:
        updated = document.with_suffix(".updated")
        updated.write_text(replacement)
        updated.replace(document)
    os.utime(document, ns=(previous.st_atime_ns, previous.st_mtime_ns))
    assert holding.read(str(document))["text"] == document.read_text()
    assert len(calls) == 2


@pytest.mark.parametrize("limit", ["bytes", "documents"])
def test_the_cache_evicts_the_least_recently_read_document(machine, tmp_path, monkeypatch, limit):
    import sys

    import syrax_search.reading as reading

    text = "synthetic external document contents " * 2
    holding = Reader(machine, open_index(machine.database_path))
    if limit == "bytes":
        monkeypatch.setattr(reading, "MAXIMUM_HELD_TEXT_BYTES", 2 * sys.getsizeof(text))
    else:
        monkeypatch.setattr(reading, "MAXIMUM_HELD_DOCUMENTS", 2)
    documents = [tmp_path / "outside" / f"document-{one}.md" for one in range(3)]
    for document in documents:
        document.write_text(text)
    original = reading.extract
    calls = []

    def observed(path):
        calls.append(path)
        return original(path)

    monkeypatch.setattr(reading, "extract", observed)
    for document in documents[:2]:
        holding.read(str(document))
    holding.read(str(documents[0]))
    holding.read(str(documents[2]))
    holding.read(str(documents[0]))
    assert len(calls) == 3, "the recent first document survives admitting the third"
    holding.read(str(documents[1]))
    assert calls[-1] == str(documents[1])
    assert len(calls) == 4, "the least recent second document was evicted"
    assert holding.sweep(now=float("inf")) == 2
    assert holding.sweep(now=float("inf")) == 0
    for document in documents[:2]:
        holding.read(str(document))
    assert holding.sweep(now=float("inf")) == 2, "expiry releases the full cache budget"


def test_an_oversized_document_is_returned_without_being_cached(machine, tmp_path, monkeypatch):
    import syrax_search.reading as reading

    monkeypatch.setattr(reading, "MAXIMUM_HELD_TEXT_BYTES", 100)
    holding = Reader(machine, open_index(machine.database_path))
    document = tmp_path / "outside" / "large.md"
    text = "large synthetic external document " * 7000
    document.write_text(text)
    reply = holding.read(str(document))
    assert reply["read"] == "ok"
    assert reply["text"] == text[: reading.MAXIMUM_REPLY_CHARACTERS]
    assert reply["truncated"]
    assert holding.sweep(now=float("inf")) == 0
