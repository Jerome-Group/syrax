"""What a close call offers, and what comes back when the Owner taps one of it."""

from __future__ import annotations

import time

from syrax_search.retrieval import Candidate, Verdict
from syrax_search.shortlist import Shortlists, token_of


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


def test_a_close_call_offers_a_value_per_candidate_and_one_for_none_of_them():
    shortlists = Shortlists()
    offer = shortlists.offer(close_call(), None, "answer1")
    assert offer["verdict"] == "ambiguous"
    assert len(offer["results"]) == 3
    assert offer["none_of_these"] not in {one["choice"] for one in offer["results"]}
    for result in offer["results"]:
        assert shortlists.resolve(result["choice"])["result"]["path"] == result["path"]


def test_a_tappable_value_is_the_answer_it_belongs_to_and_a_position():
    """Both taps and replies are captured against one answer, so the button carries its token."""
    offer = Shortlists().offer(close_call(), None, "answer1")
    assert [one["choice"] for one in offer["results"]] == ["answer1:0", "answer1:1", "answer1:2"]
    assert offer["none_of_these"] == "answer1:none"


def test_a_confident_verdict_offers_nothing_to_choose_between():
    confident = Verdict("confident", (Candidate("/documents/quiver.md", "quiver.md", True),), 0.12)
    reply = Shortlists().offer(confident, None, "answer1")
    assert "none_of_these" not in reply
    assert set(reply["results"][0]) == {"path", "name", "contents_indexed"}


def test_an_empty_verdict_offers_nothing_at_all():
    reply = Shortlists().offer(Verdict("empty", (), -0.05), None, "answer1")
    assert reply["results"] == []
    assert "none_of_these" not in reply


def test_a_tap_names_the_document_it_stands_for():
    shortlists = Shortlists()
    offer = shortlists.offer(close_call(), None, "answer1")
    chosen = shortlists.resolve(offer["results"][1]["choice"])
    assert chosen == {
        "choice": "chosen",
        "result": {"path": "/documents/rowing.md", "name": "rowing.md", "contents_indexed": True},
    }


def test_the_none_of_these_tap_chooses_no_document():
    shortlists = Shortlists()
    offer = shortlists.offer(close_call(), None, "answer1")
    assert shortlists.resolve(offer["none_of_these"]) == {"choice": "declined"}


def test_a_tap_on_an_aged_out_shortlist_says_so_rather_than_sending_anything():
    shortlists = Shortlists(lifetime_seconds=0)
    offer = shortlists.offer(close_call(), None, "answer1")
    assert shortlists.resolve(offer["results"][0]["choice"]) == {"choice": "expired"}


def test_a_tap_no_process_ever_minted_is_expired_too():
    """A restart purges every shortlist, and the Owner's next move is the same either way."""
    assert Shortlists().resolve("nevermINTed:0") == {"choice": "expired"}
    assert Shortlists().resolve("") == {"choice": "expired"}


def test_a_tap_past_the_end_of_its_own_shortlist_sends_nothing():
    shortlists = Shortlists()
    token = token_of(shortlists.offer(close_call(), None, "answer1")["results"][0]["choice"])
    assert shortlists.resolve(f"{token}:7") == {"choice": "expired"}


def test_sweeping_forgets_what_has_aged_out_and_keeps_what_has_not():
    shortlists = Shortlists(lifetime_seconds=60)
    offer = shortlists.offer(close_call(), None, "answer1")
    assert shortlists.sweep(time.monotonic()) == 0
    assert shortlists.resolve(offer["results"][0]["choice"])["choice"] == "chosen"
    assert shortlists.sweep(time.monotonic() + 61) == 1
    assert shortlists.resolve(offer["results"][0]["choice"]) == {"choice": "expired"}


def test_a_shortlist_offered_to_one_scope_does_not_resolve_through_another():
    """The boundary a scope draws over `search` holds over the taps that come back from it."""
    shortlists = Shortlists()
    offer = shortlists.offer(close_call(), "academic", "answer1")
    tapped = offer["results"][0]["choice"]

    assert shortlists.resolve(tapped, "academic")["choice"] == "chosen"
    assert shortlists.resolve(tapped, None) == {"choice": "expired"}
    assert shortlists.resolve(tapped, "media") == {"choice": "expired"}
