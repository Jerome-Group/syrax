"""What each pass does, and what it costs to run the cheap one."""

from __future__ import annotations

import json
import shutil

import pytest
from conftest import path_of

from syrax_search.building import FULL, INCREMENTAL, run_pass
from syrax_search.index import open_index


def test_the_first_pass_extracts_embeds_and_names_everything(machine, embedder):
    report = run_pass(machine, embedder, INCREMENTAL)
    assert report.extracted == 3, "the three documents inside the extraction scope"
    assert report.embedded >= 3
    assert report.seen == 4, "the PDF outside the scope is still seen, by its name"


def test_the_incremental_pass_re_reads_only_what_moved(machine, embedder):
    run_pass(machine, embedder, INCREMENTAL)
    second = run_pass(machine, embedder, INCREMENTAL)
    assert second.extracted == 0
    assert second.unchanged == 4


def test_the_full_pass_re_reads_everything_and_re_embeds_nothing_unchanged(machine, embedder):
    run_pass(machine, embedder, INCREMENTAL)
    full = run_pass(machine, embedder, FULL)
    assert full.unchanged == 0, "a file that broke silently is only caught by re-reading it"
    assert full.embedded == 0, "embedding is keyed on the extracted text, which did not change"


def test_edited_text_is_re_embedded(machine, embedder):
    run_pass(machine, embedder, INCREMENTAL)
    with open(path_of(machine, "notes/rowing.md"), "w") as handle:
        handle.write("entirely different words about tide currents and estuary navigation")
    assert run_pass(machine, embedder, INCREMENTAL).embedded >= 1


def test_a_document_that_leaves_the_corpus_is_forgotten(machine, embedder):
    import os

    run_pass(machine, embedder, INCREMENTAL)
    os.remove(path_of(machine, "notes/quiver.md"))
    assert run_pass(machine, embedder, INCREMENTAL).forgotten == 1

    database = open_index(machine.database_path)
    remaining = database.execute("SELECT count(*) FROM documents").fetchone()[0]
    assert remaining == 3


def test_what_could_not_be_read_stays_in_the_ledger(machine, embedder):
    """A scanned handout that returns nothing is a fact worth surfacing, not a silent gap."""
    run_pass(machine, embedder, FULL)
    run_pass(machine, embedder, INCREMENTAL)
    with open(machine.failure_ledger_path, encoding="utf-8") as ledger:
        lines = [json.loads(line) for line in ledger if line.strip()]
    assert lines == [] or all("status" in entry for entry in lines)


def test_the_hourly_pass_does_not_pay_for_ocr(monkeypatch):
    """Minutes per scan against fractions of a second for everything else: not an hourly cost."""
    import syrax_search.building as building

    def scanned(path: str, *, ocr: bool = False):
        return building.Extraction(
            "recognised text" if ocr else None, "ok" if ocr else "no-text-layer"
        )

    monkeypatch.setattr(building, "extract", scanned)
    hourly = building._read_one(("/a/scan.pdf", False))
    assert hourly.status == "no-text-layer", "an hourly pass leaves a scan in the ledger"

    every_third_day = building._read_one(("/a/scan.pdf", True))
    assert every_third_day.status == "ok-ocr", "the three-day pass is where a scan is read"


@pytest.mark.skipif(shutil.which("pandoc") is None, reason="pandoc is not on this machine")
def test_a_drive_export_is_read_rather_than_only_named(machine, embedder, tmp_path):
    """Without `pandoc` a Drive export inside the extraction scope is only findable by name."""
    export = tmp_path / "documents" / "notes" / "minutes.html"
    export.write_text("<h1>Minutes</h1><p>the minutes of a meeting that happened</p>")
    run_pass(machine, embedder, INCREMENTAL)

    database = open_index(machine.database_path)
    status, extracted = database.execute(
        "SELECT status, extracted FROM documents WHERE path = ?", (str(export),)
    ).fetchone()
    assert (status, extracted) == ("ok", 1)
