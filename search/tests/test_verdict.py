"""The three verdicts over the fixture corpus, and what a verdict is allowed to say."""

from __future__ import annotations

from syrax_search.building import INCREMENTAL, run_pass
from syrax_search.index import open_index
from syrax_search.retrieval import CONFIDENT_FLOOR, search


def answer(machine, embedder, query: str, scope: str | None = None):
    run_pass(machine, embedder, INCREMENTAL)
    database = open_index(machine.database_path)
    return search(database, query, embedder.embed_query(query), scope)


def test_a_query_that_names_its_target_is_confident(machine, embedder):
    verdict = answer(machine, embedder, "artin wedderburn theorem semisimple rings")
    assert verdict.state == "confident"
    assert len(verdict.candidates) == 1
    assert verdict.candidates[0].name == "wedderburn.md"


def test_a_query_the_corpus_cannot_answer_is_empty(machine, embedder):
    verdict = answer(machine, embedder, "sourdough hydration bulk fermentation")
    assert verdict.state == "empty"
    assert verdict.candidates == ()


def test_a_query_spread_across_documents_offers_a_shortlist(machine, embedder):
    verdict = answer(machine, embedder, "theorem modules stroke")
    assert verdict.state == "ambiguous"
    assert 1 <= len(verdict.candidates) <= 3


def test_a_verdict_never_carries_a_score(machine, embedder):
    reply = answer(machine, embedder, "artin wedderburn theorem semisimple rings").as_reply()
    assert reply["floor"] == CONFIDENT_FLOOR
    assert "provisional" in reply["floor_provenance"]
    for result in reply["results"]:
        assert set(result) == {"path", "name", "contents_indexed"}


def test_a_document_known_only_by_its_name_says_so(machine, embedder):
    verdict = answer(machine, embedder, "receipt")
    named = [one for one in verdict.candidates if one.name == "receipt.pdf"]
    assert named and named[0].extracted is False


def test_a_scope_is_a_restriction_on_the_same_retrieval(machine, embedder):
    notes = machine.scopes["notes"]
    verdict = answer(machine, embedder, "receipt", scope=notes)
    assert all(one.path.startswith(notes + "/") for one in verdict.candidates)
