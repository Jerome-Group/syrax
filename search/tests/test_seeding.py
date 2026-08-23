"""Turning a hand-written list of queries into entries the report can score."""

from __future__ import annotations

import json

import pytest
from conftest import path_of

from syrax_search.benchmark import FIXTURE, entries
from syrax_search.building import INCREMENTAL, run_pass
from syrax_search.seeding import seed


@pytest.fixture
def indexed(machine, embedder):
    run_pass(machine, embedder, INCREMENTAL)
    return machine


def written(machine, lines: list[dict], tmp_path) -> str:
    source = tmp_path / "queries.jsonl"
    source.write_text("\n".join(json.dumps(one) for one in lines) + "\n")
    return str(source)


def test_a_query_becomes_an_entry_holding_what_it_scored(indexed, embedder, tmp_path):
    """The scores are the index's as it stands, which is the half a rebuild would destroy."""
    source = written(
        indexed,
        [{"query": "artin wedderburn theorem semisimple rings", "expect": ["wedderburn.md"]}],
        tmp_path,
    )
    report = seed(indexed, embedder, source)

    assert report.seeded == 1
    entry = entries(indexed.benchmark_path)[0]
    assert entry.origin == FIXTURE
    assert entry.shape is None, "a query kept to catch a regression is not a miss"
    assert entry.expect == (path_of(indexed, "notes/wedderburn.md"),)
    assert entry.verdict == "confident"
    assert entry.best is not None and entry.scores


def test_a_fragment_naming_several_documents_expects_all_of_them(indexed, embedder, tmp_path):
    """One chapter is three documents, and any of them coming first is the query answered."""
    source = written(indexed, [{"query": "notes", "expect": ["notes/"]}], tmp_path)
    seed(indexed, embedder, source)

    assert len(entries(indexed.benchmark_path)[0].expect) > 1


def test_a_query_whose_answer_is_nothing_says_so(indexed, embedder, tmp_path):
    source = written(
        indexed, [{"query": "sourdough hydration bulk fermentation", "nothing": True}], tmp_path
    )
    seed(indexed, embedder, source)

    entry = entries(indexed.benchmark_path)[0]
    assert entry.expects_nothing and not entry.is_pending
    assert entry.verdict == "empty"


def test_a_fragment_that_names_no_document_is_refused_and_named(indexed, embedder, tmp_path):
    """An expectation the index cannot hold is a broken test, and a broken test is not a bar."""
    source = written(
        indexed,
        [
            {"query": "one", "expect": ["a document nobody has"]},
            {"query": "artin wedderburn theorem semisimple rings", "expect": ["wedderburn.md"]},
        ],
        tmp_path,
    )
    report = seed(indexed, embedder, source)

    assert report.seeded == 1
    assert report.refused == [("one", "a document nobody has")]
    assert [one.query for one in entries(indexed.benchmark_path)] == [
        "artin wedderburn theorem semisimple rings"
    ]


def test_seeding_twice_does_not_weigh_a_query_twice(indexed, embedder, tmp_path):
    """The set accretes and is never rewritten, so the guard against a double is here."""
    source = written(
        indexed,
        [{"query": "artin wedderburn theorem semisimple rings", "expect": ["wedderburn.md"]}],
        tmp_path,
    )
    seed(indexed, embedder, source)
    again = seed(indexed, embedder, source)

    assert again.seeded == 0
    assert again.already == ["artin wedderburn theorem semisimple rings"]
    assert len(entries(indexed.benchmark_path)) == 1


def test_a_named_scope_is_seeded_as_the_root_it_stands_for(indexed, embedder, tmp_path):
    """The entry carries what `search` takes, so scoring it re-runs the search that was scored."""
    source = written(
        indexed, [{"query": "receipt", "expect": ["receipt"], "scope": "notes"}], tmp_path
    )
    seed(indexed, embedder, source)

    assert entries(indexed.benchmark_path)[0].scope == indexed.scopes["notes"]
