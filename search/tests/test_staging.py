"""`attach`: what the unit will hand over, where it puts it, and what it refuses."""

from __future__ import annotations

import os

from syrax_search.staging import Staging


def contents(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def test_a_document_is_handed_over_under_the_runtimes_own_state(machine, tmp_path):
    original = str(tmp_path / "documents" / "notes" / "rowing.md")
    handed = Staging(machine).attach(original)

    assert handed["attach"] == "ok"
    assert handed["name"] == "rowing.md"
    assert handed["path"].startswith(machine.staging_root + os.sep)
    assert os.path.basename(handed["path"]) == "rowing.md"
    assert contents(handed["path"]) == contents(original)


def test_the_original_is_left_where_it_lives(machine, tmp_path):
    original = str(tmp_path / "documents" / "notes" / "rowing.md")
    Staging(machine).attach(original)
    assert os.path.isfile(original)


def test_two_documents_of_one_name_do_not_collide(machine, tmp_path):
    staging = Staging(machine)
    first = staging.attach(str(tmp_path / "documents" / "notes" / "rowing.md"))
    (tmp_path / "elsewhere").mkdir()
    (tmp_path / "elsewhere" / "rowing.md").write_text("a different document of the same name")
    second = staging.attach(str(tmp_path / "elsewhere" / "rowing.md"))

    assert first["path"] != second["path"]
    assert contents(second["path"]) == "a different document of the same name"


def test_the_handover_is_private(machine, tmp_path):
    handed = Staging(machine).attach(str(tmp_path / "documents" / "notes" / "rowing.md"))
    assert os.stat(os.path.dirname(handed["path"])).st_mode & 0o077 == 0


def test_the_blocklist_is_refused_here_exactly_as_it_is_by_read(machine, tmp_path):
    refused = Staging(machine).attach(str(tmp_path / "private" / "diary.md"))
    assert refused["attach"] == "refused"
    assert "blocklist" in refused["reason"]


def test_a_symlink_is_refused_rather_than_followed(machine, tmp_path):
    link = tmp_path / "shortcut.md"
    link.symlink_to(tmp_path / "documents" / "notes" / "rowing.md")
    refused = Staging(machine).attach(str(link))
    assert refused["attach"] == "refused"
    assert "symlink" in refused["reason"]


def test_a_path_that_is_not_a_file_is_refused(machine, tmp_path):
    refused = Staging(machine).attach(str(tmp_path / "documents"))
    assert refused == {
        "attach": "refused",
        "path": str(tmp_path / "documents"),
        "reason": "not a file",
    }


def test_sweeping_removes_a_handover_nobody_sent(machine, tmp_path):
    staging = Staging(machine)
    handed = staging.attach(str(tmp_path / "documents" / "notes" / "rowing.md"))

    assert staging.sweep(0) == 0
    assert os.path.isfile(handed["path"])
    assert staging.sweep(machine.idle_evict_seconds + 1e9) == 1
    assert not os.path.exists(os.path.dirname(handed["path"]))
