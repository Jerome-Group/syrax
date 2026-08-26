"""What a close call offers, and what comes back when the Owner says one of its numbers."""

from __future__ import annotations

import time

from syrax_search.retrieval import Candidate, Verdict
from syrax_search.shortlist import DECLINE, Shortlists


def close_call() -> Verdict:
    return Verdict(
        "ambiguous",
        (
            Candidate("/documents/quiver.md", "quiver.md", True),
            Candidate("/documents/rowing.md", "rowing.md", True),
            Candidate("/scanned/receipt.pdf", "receipt.pdf", False),
        ),
        0.12,
    )


def test_a_close_call_numbers_its_own_candidates_from_one():
    """The line the Owner reads a document on is the unit's, and it is what they say back.

    A model counting its own list can print `3.` beside the fourth name, and *three* then fetches
    a document whose name they never read — which is #192 arriving through its own fix.
    """
    offer = Shortlists().offer(close_call(), None, "answer1")

    assert [one["position"] for one in offer["results"]] == [1, 2, 3]
    for result in offer["results"]:
        assert set(result) == {"path", "name", "contents_indexed", "position"}


def test_a_close_call_mints_no_value_for_the_model_to_carry():
    """ADR-0033: ten tokens in a tool call was the thing two models could not emit.

    One `answer` reaches the chat, on the reply `search` already returns, and the model passes it
    back beside a number it read off the Owner's own message.
    """
    offer = Shortlists().offer(close_call(), None, "answer1")

    assert "none_of_these" not in offer
    assert not any("choice" in one for one in offer["results"])


def test_the_number_the_owner_said_names_the_document_it_stands_for():
    shortlists = Shortlists()
    shortlists.offer(close_call(), None, "answer1")

    assert shortlists.resolve("answer1", 2) == {
        "choice": "chosen",
        "result": {"path": "/documents/rowing.md", "name": "rowing.md", "contents_indexed": True},
    }


def test_what_comes_back_is_a_document_rather_than_a_line_of_a_list():
    shortlists = Shortlists()
    shortlists.offer(close_call(), None, "answer1")

    assert set(shortlists.resolve("answer1", 2)["result"]) == {
        "path",
        "name",
        "contents_indexed",
    }


def test_none_of_them_is_the_one_number_a_list_from_one_does_not_have():
    shortlists = Shortlists()
    shortlists.offer(close_call(), None, "answer1")

    assert DECLINE == 0
    assert shortlists.resolve("answer1", DECLINE) == {"choice": "declined"}


def test_a_confident_verdict_offers_nothing_to_choose_between():
    confident = Verdict("confident", (Candidate("/documents/quiver.md", "quiver.md", True),), 0.12)
    reply = Shortlists().offer(confident, None, "answer1")
    assert set(reply["results"][0]) == {"path", "name", "contents_indexed"}


def test_an_empty_verdict_offers_nothing_at_all():
    reply = Shortlists().offer(Verdict("empty", (), -0.05), None, "answer1")
    assert reply["results"] == []


def test_a_number_against_an_aged_out_shortlist_says_so_rather_than_sending_anything():
    shortlists = Shortlists(lifetime_seconds=0)
    shortlists.offer(close_call(), None, "answer1")
    assert shortlists.resolve("answer1", 1) == {"choice": "expired"}


def test_an_answer_no_process_ever_offered_is_expired_too():
    """A restart purges every shortlist, and the Owner's next move is the same either way."""
    assert Shortlists().resolve("nevermINTed", 1) == {"choice": "expired"}
    assert Shortlists().resolve("", 1) == {"choice": "expired"}


def test_a_number_past_the_end_of_its_own_shortlist_sends_nothing():
    """Three lines were offered and the Owner said seven: that is not this shortlist's answer."""
    shortlists = Shortlists()
    shortlists.offer(close_call(), None, "answer1")

    assert shortlists.resolve("answer1", 7) == {"choice": "expired"}
    assert shortlists.resolve("answer1", -1) == {"choice": "expired"}


def test_a_position_that_is_not_a_whole_number_expires_rather_than_raising():
    """It comes from a model reading a digit out of the Owner's message, so it may arrive wrong.

    `expired` is a reply the chat knows how to say. A `TypeError` out of the resident unit is not.
    """
    shortlists = Shortlists()
    shortlists.offer(close_call(), None, "answer1")

    for said in ["2", "two", 1.5, None, True]:
        assert shortlists.resolve("answer1", said) == {"choice": "expired"}, said


def test_sweeping_forgets_what_has_aged_out_and_keeps_what_has_not():
    shortlists = Shortlists(lifetime_seconds=60)
    shortlists.offer(close_call(), None, "answer1")
    assert shortlists.sweep(time.monotonic()) == 0
    assert shortlists.resolve("answer1", 1)["choice"] == "chosen"
    assert shortlists.sweep(time.monotonic() + 61) == 1
    assert shortlists.resolve("answer1", 1) == {"choice": "expired"}


def test_a_shortlist_offered_to_one_scope_does_not_resolve_through_another():
    """The boundary a scope draws over `search` holds over the answers that come back from it."""
    shortlists = Shortlists()
    shortlists.offer(close_call(), "academic", "answer1")

    assert shortlists.resolve("answer1", 1, "academic")["choice"] == "chosen"
    assert shortlists.resolve("answer1", 1, None) == {"choice": "expired"}
    assert shortlists.resolve("answer1", 1, "media") == {"choice": "expired"}
