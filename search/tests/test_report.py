"""The retrieval report over the fixture corpus: what it states, and what it refuses to touch."""

from __future__ import annotations

import json

import pytest
from conftest import path_of

from syrax_search import retrieval
from syrax_search.benchmark import FIXTURE, Entry, append
from syrax_search.building import INCREMENTAL, run_pass
from syrax_search.report import FITTING_MARGIN, run
from syrax_search.retrieval import CONFIDENT_FLOOR


@pytest.fixture
def indexed(machine, embedder):
    run_pass(machine, embedder, INCREMENTAL)
    return machine


def entry(machine, query: str, expect: str | None, **overrides) -> Entry:
    return append(
        machine.benchmark_path,
        Entry(
            query=query,
            shape=overrides.pop("shape", "confident-and-wrong"),
            verdict=overrides.pop("verdict", "confident"),
            floor=CONFIDENT_FLOOR,
            scores=overrides.pop("scores", {}),
            best=overrides.pop("best", 0.2),
            expect=_expected(machine, expect),
            **overrides,
        ),
    )


def _expected(machine, expect) -> tuple[str, ...]:
    """One name or several, each relative to the root the fixture corpus sits in."""
    if expect is None:
        return ()
    wanted = [expect] if isinstance(expect, str) else expect
    return tuple(path_of(machine, one) for one in wanted)


def written(machine) -> dict:
    with open(machine.retrieval_report_path, encoding="utf-8") as handle:
        return json.load(handle)


def test_an_answered_entry_counts_as_answered_and_first(indexed, embedder):
    entry(indexed, "artin wedderburn theorem semisimple rings", "notes/wedderburn.md")
    numbers = run(indexed, embedder).numbers

    assert numbers["scored"] == 1
    assert numbers["found"] == 1
    assert numbers["first"] == 1


def test_a_pending_entry_neither_inflates_nor_deflates_the_score(indexed, embedder):
    """It waits, and it is listed — which is what stops the set becoming mostly pending."""
    entry(indexed, "artin wedderburn theorem semisimple rings", "notes/wedderburn.md")
    entry(indexed, "MH1101 25/26 Final", None)
    report = run(indexed, embedder)

    assert report.numbers["scored"] == 1
    assert report.numbers["pending"] == 1
    assert report.pending_queries == ["MH1101 25/26 Final"]


def test_the_report_states_the_re_fitted_floor_beside_the_pinned_one(indexed, embedder):
    entry(indexed, "artin wedderburn theorem semisimple rings", "notes/wedderburn.md")
    entry(indexed, "quiver representations path algebra", "notes/rowing.md")
    report = run(indexed, embedder).as_reply()

    assert report["confident_floor"]["pinned"] == CONFIDENT_FLOOR
    assert report["confident_floor"]["refitted"] == round(
        report["confident_floor"]["best_wrong"] + FITTING_MARGIN, 3
    )
    assert report["confident_floor"]["applied"] is False


def test_the_re_fitted_floor_carries_the_counts_that_make_it_legible(indexed, embedder):
    """A set that grows by capturing failures drifts conservative, and only the counts show it."""
    entry(indexed, "artin wedderburn theorem semisimple rings", "notes/wedderburn.md")
    entry(indexed, "quiver representations path algebra", "notes/quiver.md", origin=FIXTURE)
    numbers = run(indexed, embedder).as_reply()["numbers"]

    assert numbers["fixture"] == 1
    assert numbers["live"] == 1
    assert numbers["total"] == 2


def test_the_report_never_applies_what_it_computed(indexed, embedder):
    """The line is at configuration: computing is reporting, writing is a person's act."""
    entry(indexed, "quiver representations path algebra", "notes/rowing.md")
    report = run(indexed, embedder)

    assert report.numbers["refitted_confident_floor"] != CONFIDENT_FLOOR
    assert retrieval.CONFIDENT_FLOOR == 0.12


def test_a_set_with_nothing_to_fit_against_states_no_re_fitted_floor(indexed, embedder):
    entry(indexed, "artin wedderburn theorem semisimple rings", "notes/wedderburn.md")
    report = run(indexed, embedder)

    assert report.numbers["refitted_confident_floor"] is None
    assert report.worst_right is not None


def test_a_report_is_written_to_file_whether_or_not_anything_moved(indexed, embedder):
    entry(indexed, "artin wedderburn theorem semisimple rings", "notes/wedderburn.md")
    first = run(indexed, embedder)
    assert written(indexed)["numbers"] == first.numbers

    second = run(indexed, embedder)
    assert second.moved == ()
    assert second.is_worth_posting is False
    assert written(indexed)["numbers"] == second.numbers


def test_a_number_that_moved_is_named(indexed, embedder):
    entry(indexed, "artin wedderburn theorem semisimple rings", "notes/wedderburn.md")
    run(indexed, embedder)
    entry(indexed, "rowing erg splits stroke rate", "notes/rowing.md")
    moved = run(indexed, embedder)

    assert "scored" in moved.moved
    assert moved.is_worth_posting


def test_the_first_report_says_so_rather_than_claiming_nothing_moved(indexed, embedder):
    entry(indexed, "artin wedderburn theorem semisimple rings", "notes/wedderburn.md")
    assert run(indexed, embedder).moved == ("first report",)


def test_a_run_that_fails_is_reported_and_leaves_the_last_numbers_standing(indexed, embedder):
    entry(indexed, "artin wedderburn theorem semisimple rings", "notes/wedderburn.md")
    good = run(indexed, embedder)

    class Broken:
        def embed_query(self, text: str):
            raise RuntimeError("the export is not where it was")

    failed = run(indexed, Broken())
    assert failed.failed is not None and "the export is not where it was" in failed.failed
    assert failed.is_worth_posting
    assert failed.numbers == good.numbers
    assert written(indexed)["failed"] == failed.failed


def test_any_of_several_correct_documents_counts_as_first(indexed, embedder):
    """A chapter the corpus holds three renderings of is answered by any one of them."""
    entry(
        indexed,
        "artin wedderburn theorem semisimple rings",
        ["notes/quiver.md", "notes/wedderburn.md"],
    )
    numbers = run(indexed, embedder).numbers

    assert numbers["found"] == 1
    assert numbers["first"] == 1, "the answer came first, and it is the second one named"


def test_an_entry_that_expects_nothing_is_scored_on_getting_nothing(indexed, embedder):
    """The queries that catch a floor drifting the wrong way are the ones with no answer."""
    entry(indexed, "sourdough hydration bulk fermentation", None, expects_nothing=True)
    numbers = run(indexed, embedder).numbers

    assert numbers["scored"] == 1
    assert numbers["pending"] == 0
    assert numbers["found"] == 1 and numbers["first"] == 1


def test_an_entry_that_expects_nothing_and_gets_something_is_a_miss(indexed, embedder):
    entry(indexed, "artin wedderburn theorem semisimple rings", None, expects_nothing=True)
    numbers = run(indexed, embedder).numbers

    assert numbers["scored"] == 1
    assert numbers["found"] == 0 and numbers["first"] == 0


def test_a_query_that_should_be_empty_and_is_not_is_fitted_against(indexed, embedder):
    """It is the clearest wrong top answer there is, and the floor has to clear it."""
    entry(indexed, "artin wedderburn theorem semisimple rings", None, expects_nothing=True)
    report = run(indexed, embedder)

    assert report.numbers["found"] == 0
    assert report.best_wrong is not None, "the document it wrongly returned has a score"
    assert report.numbers["refitted_confident_floor"] == round(
        report.best_wrong + FITTING_MARGIN, 3
    )
