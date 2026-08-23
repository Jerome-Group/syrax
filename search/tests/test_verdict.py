"""The three verdicts over the fixture corpus, and what a verdict is allowed to say."""

from __future__ import annotations

from syrax_search.building import INCREMENTAL, run_pass
from syrax_search.index import open_index
from syrax_search.retrieval import CONFIDENT_FLOOR, SHORTLIST, arms_agree, fuse, search


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
    assert 1 <= len(verdict.candidates) <= SHORTLIST


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


def test_a_year_written_in_two_digits_means_the_one_written_in_four():
    """A rule about what two consecutive numbers are, not a table of the years anybody has."""
    from syrax_search.terms import forms_of

    assert forms_of(["mh1101", "final", "25", "26"]) == (
        ("mh1101",),
        ("final",),
        ("25", "2025"),
        ("26", "2026"),
    )
    assert forms_of(["2025", "2026"]) == (("2025",), ("2026",)), "four digits already say it"
    assert forms_of(["tutorial", "12"]) == (("tutorial",), ("12",)), "a lone number is a count"
    assert forms_of(["chapter", "11", "12"]) == (
        ("chapter",),
        ("11", "2011"),
        ("12", "2012"),
    ), "the rule cannot tell this from an academic year, and reaches 2011 and 2012 for it"
    assert forms_of(["s2", "7"]) == (("s2",), ("7",))


def test_a_two_digit_year_reaches_the_document_that_writes_it_in_four(machine, embedder):
    """`25/26` is the whole of the query, and the corpus writes that year `2025-2026`."""
    verdict = answer(machine, embedder, "25/26")
    assert verdict.state != "empty"
    assert any(one.name == "exam 2025-2026 semester 2.md" for one in verdict.candidates)


def test_two_arms_agreeing_is_not_spent_on_a_single_position(machine, embedder):
    """The three arms fuse once. Nesting the keyword halves cost them their margin.

    Fusing text and name into a keyword arm first re-ranked them to positions, so a document both
    halves agreed on arrived at the final fusion worth exactly what a lone vector hit was worth, and
    lost to it on insertion order. Twenty-one benchmark queries: the answer came first for five of
    them nested and nine flat.
    """
    assert fuse([1], [2, 3], [2])[0] == 2


def test_a_close_call_offers_more_than_the_three_it_used_to(machine, embedder):
    """Ten, because for three captured phrasings of one query the answer sat at rank 5, 6 and 8.

    Every one of them was inside the pool the fusion ranked and outside the shortlist drawn from it,
    which is the one thing a person can fix that the ranking cannot (#151).
    """
    verdict = answer(machine, embedder, "exam 2025 2026 semester quiver rowing")
    assert verdict.state == "ambiguous"
    assert len(verdict.candidates) > 3, "the fixture corpus holds five, so three was a truncation"
    assert SHORTLIST == 10, (
        "the fixture corpus is too small to reach ten, so the number ADR-0028 argues for is "
        "asserted here rather than left to a corpus that cannot tell four from ten"
    )
