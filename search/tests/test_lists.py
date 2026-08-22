"""The three lists do three different jobs, and only one of them is a boundary."""

from __future__ import annotations

import os

import pytest

from syrax_search.config import InvalidDeployment, read_deployment
from syrax_search.lists import Lists, literal_prefix
from syrax_search.walk import crawl


def crawled(config) -> dict[str, bool]:
    return {candidate.path: candidate.extracted for candidate in crawl(config.lists)}


def test_the_allowlist_bounds_what_is_crawled(machine):
    found = crawled(machine)
    assert any(path.endswith("wedderburn.md") for path in found)
    assert not any("outside" in path for path in found)


def test_the_extraction_scope_is_narrower_than_the_allowlist(machine):
    found = crawled(machine)
    inside = next(path for path in found if path.endswith("wedderburn.md"))
    named_only = next(path for path in found if path.endswith("receipt.pdf"))
    assert found[inside] is True
    assert found[named_only] is False, "outside the scope a document is indexed by its name alone"


def test_the_blocklist_reaches_outside_the_allowlist_entirely(machine, tmp_path):
    forbidden = str(tmp_path / "private" / "diary.md")
    assert machine.lists.indexes(forbidden) is False
    assert machine.lists.blocks(forbidden) is not None


def test_the_index_root_blocks_itself(machine):
    """Without this the index indexes its own extracted text, and the chat archive with it."""
    assert machine.lists.blocks(machine.database_path) is not None


def test_dotfiles_and_credential_shapes_are_blocked_wherever_they_sit(machine, tmp_path):
    for name in (".env", "id_ed25519", "server.pem", "backup.sparsebundle"):
        assert machine.lists.blocks(str(tmp_path / name)) is not None
    assert machine.lists.blocks(str(tmp_path / "notes" / ".hidden" / "page.md")) is not None


def test_a_symlink_is_never_followed(machine, tmp_path):
    """`~/Google Drive` points at the same tree as `/Volumes/RAID0/My Drive` on this machine."""
    documents = machine.lists.index_allowlist[0]
    os.symlink(str(tmp_path / "outside"), os.path.join(documents, "linked-tree"))
    os.symlink(str(tmp_path / "outside" / "letter.md"), os.path.join(documents, "linked-letter.md"))
    found = crawled(machine)
    assert not any("letter" in path or "linked-tree" in path for path in found)


def test_an_extraction_scope_outside_the_allowlist_is_refused(tmp_path):
    deployment = tmp_path / "deployment.json"
    deployment.write_text(
        '{"searchIndex": "/tmp/i", "indexAllowlist": ["/a"], '
        '"extractionScope": ["/b"], "blocklist": ["/c"]}'
    )
    with pytest.raises(InvalidDeployment, match="subset"):
        read_deployment(str(deployment))


def test_a_scope_entry_may_be_a_pattern():
    """One root holds a faculty's papers where only one department's are wanted."""
    papers = "/allowed/papers"
    lists = Lists(
        index_allowlist=("/allowed",),
        extraction_scope=(f"{papers}/*/AB*.pdf",),
        blocked_roots=(),
    )
    assert lists.extracts(f"{papers}/2025-2026 Semester 2/AB1234 2025-2026 Semester 2.pdf")
    assert not lists.extracts(f"{papers}/2025-2026 Semester 2/CD5678 2025-2026 Semester 2.pdf")
    assert not lists.extracts(f"{papers}/2025-2026 Semester 2/AB1234 notes.txt")


def test_a_pattern_is_anchored_at_the_directory_it_names(tmp_path):
    assert literal_prefix("/allowed/papers/*/AB*.pdf") == "/allowed/papers"
    assert literal_prefix("/allowed/papers") == "/allowed/papers"
    assert literal_prefix("/*.pdf") == "/", "a pattern with no anchor is not inside any root"


def test_a_pattern_is_still_a_subset_of_the_allowlist(tmp_path):
    deployment = tmp_path / "deployment.json"
    deployment.write_text(
        '{"searchIndex": "/tmp/i", "indexAllowlist": ["/a"], '
        '"extractionScope": ["/b/*/AB*.pdf"], "blocklist": ["/c"]}'
    )
    with pytest.raises(InvalidDeployment, match="subset"):
        read_deployment(str(deployment))


def test_a_pattern_inside_the_allowlist_is_accepted(tmp_path):
    deployment = tmp_path / "deployment.json"
    deployment.write_text(
        '{"searchIndex": "/tmp/i", "indexAllowlist": ["/a"], '
        '"extractionScope": ["/a/papers/*/AB*.pdf"], "blocklist": ["/c"]}'
    )
    assert read_deployment(str(deployment)).lists.extracts("/a/papers/2025/AB1234 final.pdf")
