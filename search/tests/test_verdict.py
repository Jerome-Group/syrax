"""The three verdicts over the fixture corpus, and what a verdict is allowed to say."""

from __future__ import annotations

from syrax_search.building import INCREMENTAL, run_pass
from syrax_search.index import open_index
from syrax_search.retrieval import CONFIDENT_FLOOR, arms_agree, search


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
    verdict = answer(machine, embedder, "quiver representations path algebra stroke rate")
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
    named = [one for one in verdict.candidates if one.name == "hardware store receipt.pdf"]
    assert named and named[0].extracted is False


def test_a_scope_is_a_restriction_on_the_same_retrieval(machine, embedder):
    notes = machine.scopes["notes"]
    verdict = answer(machine, embedder, "receipt", scope=notes)
    assert all(one.path.startswith(notes + "/") for one in verdict.candidates)


def test_a_body_word_alone_does_not_lift_a_query_off_the_empty_floor(machine, embedder):
    """One common word shared with a long document is what the floor exists to reject."""
    verdict = answer(machine, embedder, "erg zzzz yyyy xxxx wwww vvvv")
    assert verdict.state == "empty"


def test_a_name_the_query_is_mostly_made_of_does_lift_one(machine, embedder):
    """The book's own filename is why *Dummit and Foote* is right at a score below the floor."""
    verdict = answer(machine, embedder, "hardware store receipt zzzz")
    assert verdict.state == "ambiguous"
    assert any(one.name == "hardware store receipt.pdf" for one in verdict.candidates)


def test_a_name_that_matched_one_word_of_six_does_not_lift_one(machine, embedder):
    """The exemption is for a query that names its target, not one that shares a word with it.

    *my flight booking to Tokyo* matched a coursework filename on `booking` alone and was handed a
    shortlist for it — the same failure the floor exists to prevent, arriving through the door the
    floor left open.
    """
    verdict = answer(machine, embedder, "rowing zzzz yyyy xxxx wwww vvvv")
    assert verdict.state == "empty"


def test_confident_needs_the_arm_that_is_scored_to_have_chosen_the_document():
    """The floor reads a vector score, so it may only be asked about the vector arm's own best."""
    assert arms_agree(7, vector=[7, 4], keyword=[4, 7])
    assert not arms_agree(7, vector=[4, 7], keyword=[7, 4]), "the vector arm preferred another"
    assert not arms_agree(7, vector=[7, 4], keyword=[4]), "the keyword arm never ranked it"
    assert not arms_agree(7, vector=[], keyword=[7]), "nothing was scored at all"


def test_a_year_written_in_two_digits_survives_the_query(machine, embedder):
    """`25/26` is the whole of what distinguishes one paper from four hundred siblings."""
    from syrax_search.terms import terms_of

    assert terms_of("MH1101 Final 25/26") == ["mh1101", "final", "25", "26"]
    assert terms_of("the AY2425 paper for S2") == ["ay2425", "paper", "s2"]
    assert terms_of("what and for the") == [], "the rule it replaces still does its own job"
