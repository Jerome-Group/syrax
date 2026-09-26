"""What counts as a document's own text, and what only looks like it."""

from __future__ import annotations

import pytest

from syrax_search.extraction import has_text_layer

# What `pdftotext` returns for a scanned paper stamped by the library, once per page.
STAMP = (
    "ATTENTION: The Singapore Copyright Act applies to the use of this document. "
    "Nanyang Technological University Library"
)


def test_a_stamp_repeated_per_page_is_not_a_text_layer():
    """952 characters of it clears every length test, and the paper is then filed as read."""
    scanned = "\n\n\x0c".join([STAMP] * 16)
    assert len(scanned) > 900, "long enough to pass every length test there is"
    assert has_text_layer(scanned) is False


def test_a_short_document_is_still_a_document():
    assert has_text_layer("Meeting notes: we agreed to postpone the migration until the audit.")


def test_a_stamped_document_that_also_has_text_is_a_text_layer():
    """The stamp is on every page of a readable paper too — it must not condemn one."""
    page = f"{STAMP}\n\nQuestion 1. Let f be continuous on [0,1]. Show that f attains its bound."
    assert has_text_layer("\n\x0c".join([page, page, page]))


def test_nothing_is_not_a_text_layer():
    assert has_text_layer("") is False
    assert has_text_layer("  \n\x0c \n ") is False


def test_the_rule_needs_a_few_pages_to_see_the_repetition():
    """Stated rather than hidden: two stamped pages are half distinct, and are not caught.

    The share only falls once the stamp has been repeated a handful of times. A two-page scan
    therefore still enters the index on its stamp. The papers this exists for run to ten pages and
    beyond, so the limit is worth naming rather than worth chasing with a second rule.
    """
    assert has_text_layer("\n\x0c".join([STAMP] * 2)) is True
    assert has_text_layer("\n\x0c".join([STAMP] * 8)) is False


@pytest.mark.parametrize("name", ["broken.pdf", "broken.docx"])
def test_failed_converters_do_not_index_their_partial_output(monkeypatch, name):
    import subprocess

    from syrax_search.extraction import extract

    def partial(command, **kwargs):
        return subprocess.CompletedProcess(command, 1, b"otherwise usable partial document " * 5)

    monkeypatch.setattr(subprocess, "run", partial)
    extraction = extract(name)
    assert extraction.text is None
    tool = "pdftotext" if name.endswith(".pdf") else "pandoc"
    assert extraction.status == f"error:exit-{tool}-1"
    assert extraction.failed


def test_a_failed_ocr_tool_is_reported_without_returning_partial_text(monkeypatch):
    import subprocess
    from pathlib import Path

    from syrax_search.extraction import extract

    def partial(command, **kwargs):
        tool = command[0]
        if tool == "pdftoppm":
            Path(command[-1] + "-1.png").touch()
        return subprocess.CompletedProcess(
            command,
            2 if tool == "tesseract" else 0,
            b"partial text that must not enter the index" if tool == "tesseract" else b"",
        )

    monkeypatch.setattr(subprocess, "run", partial)
    extraction = extract("scan.pdf", ocr=True)
    assert extraction.text is None
    assert extraction.status == "error:exit-tesseract-2"
    assert extraction.failed


def test_successful_ocr_is_not_counted_as_a_pass_failure(machine, embedder):
    import syrax_search.building as building
    from syrax_search.extraction import Extraction
    from syrax_search.index import open_index
    from syrax_search.walk import Crawled

    database = open_index(machine.database_path)
    report = building.PassReport(kind=building.FULL)
    document = Crawled("/synthetic/scan.pdf", "scan.pdf", 100, 0, True)
    recognised = Extraction("recognised synthetic scanned document contents " * 3, "ok-ocr")
    assert not recognised.failed
    building._absorb(database, embedder, document, None, recognised, report)
    assert report.extracted == 1
    assert report.embedded > 0
    assert report.failures == []
    building._write_ledger(machine.failure_ledger_path, database, building.FULL)
    with open(machine.failure_ledger_path) as ledger:
        assert ledger.read() == ""
    database.close()
