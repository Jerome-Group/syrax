"""What a captured miss holds, and what it refuses to hold."""

from __future__ import annotations

import json

import pytest

from syrax_search.benchmark import FIXTURE, LIVE, SHAPES, Entry, by_shape, counts, entries
from syrax_search.capture import Answers
from syrax_search.retrieval import Candidate, Verdict


@pytest.fixture
def set_path(tmp_path) -> str:
    (tmp_path / "benchmark").mkdir()
    return str(tmp_path / "benchmark" / "set.jsonl")


def confident() -> Verdict:
    return Verdict(
        "confident",
        (Candidate("/documents/00 Module Profile.md", "00 Module Profile.md", True),),
        0.12,
        {"/documents/00 Module Profile.md": 0.132},
        0.149,
    )


def captured(set_path: str) -> list[Entry]:
    return entries(set_path)


def test_a_capture_records_the_shape_it_was_told(set_path):
    answers = Answers(set_path)
    answer = answers.remember("MH1101 2025-2026 Semester 2", None, confident())

    assert answers.capture(answer.token, "confident-and-wrong") == {
        "captured": "confident-and-wrong",
        "pending": True,
    }
    assert [one.shape for one in captured(set_path)] == ["confident-and-wrong"]


def test_a_capture_holds_the_verdict_and_the_scores_as_they_stood(set_path):
    """A rebuilt index destroys both, and they are the only fields nothing can recover."""
    answers = Answers(set_path)
    answer = answers.remember("MH1101 2025-2026 Semester 2", None, confident())
    answers.capture(answer.token, "confident-and-wrong")

    entry = captured(set_path)[0]
    assert entry.query == "MH1101 2025-2026 Semester 2"
    assert entry.verdict == "confident"
    assert entry.floor == 0.12
    assert entry.scores == {"/documents/00 Module Profile.md": 0.132}
    assert entry.best == 0.149


def test_an_entry_lands_marked_live_and_stamped(set_path):
    answers = Answers(set_path)
    answers.capture(answers.remember("q", None, confident()).token, "wrong-granularity")

    with open(set_path, encoding="utf-8") as handle:
        written = json.loads(handle.readline())
    assert written["origin"] == LIVE
    assert written["captured_at"].startswith("20")


def test_a_capture_without_a_correct_path_is_pending_rather_than_refused(set_path):
    """Demanding it turns one gesture into an interrogation at the worst possible moment."""
    answers = Answers(set_path)
    answer = answers.remember("MH1101 25/26 Final", None, confident())

    assert answers.capture(answer.token, "buried-in-the-shortlist")["pending"] is True
    assert captured(set_path)[0].is_pending
    assert not captured(set_path)[0].is_scorable


def test_a_capture_with_one_is_scored_rather_than_pending(set_path):
    answers = Answers(set_path)
    answer = answers.remember("MH1101 25/26 Final", None, confident())
    reply = answers.capture(answer.token, "buried-in-the-shortlist", "/documents/MH1101.pdf")

    assert reply == {"captured": "buried-in-the-shortlist", "pending": False}
    assert captured(set_path)[0].expect == "/documents/MH1101.pdf"
    assert captured(set_path)[0].is_scorable


def test_a_correct_path_that_is_not_a_path_records_nothing(set_path):
    answers = Answers(set_path)
    answer = answers.remember("q", None, confident())

    assert answers.capture(answer.token, "confident-and-wrong", "the maths paper")["captured"] == (
        "refused"
    )
    assert captured(set_path) == []


def test_a_shape_outside_the_five_records_nothing(set_path):
    answers = Answers(set_path)
    answer = answers.remember("q", None, confident())

    assert answers.capture(answer.token, "just wrong")["captured"] == "refused"
    assert captured(set_path) == []


def test_an_answer_nobody_remembers_is_refused_rather_than_re_run(set_path):
    """A re-run would record today's numbers under the day the Owner complained."""
    assert Answers(set_path).capture("neverMinted", "confident-and-wrong") == {
        "captured": "expired"
    }
    assert captured(set_path) == []


def test_an_answer_that_has_aged_out_is_expired_too(set_path):
    answers = Answers(set_path, lifetime_seconds=0)
    answer = answers.remember("q", None, confident())

    assert answers.capture(answer.token, "confident-and-wrong") == {"captured": "expired"}


def test_one_answer_captures_once(set_path):
    """The Owner rejecting a shortlist and then saying so in words is one miss, not two."""
    answers = Answers(set_path)
    answer = answers.remember("q", None, confident())
    answers.capture(answer.token, "not-in-the-shortlist")

    assert answers.capture(answer.token, "confident-and-wrong") == {
        "captured": "already",
        "shape": "not-in-the-shortlist",
    }
    assert len(captured(set_path)) == 1


def test_an_answer_token_fits_on_a_button(set_path):
    """A tap carries `<token>:<position>`, and Telegram's `callback_data` is 1-64 bytes."""
    answer = Answers(set_path).remember("q", None, confident())
    assert 1 <= len(f"{answer.token}:none".encode()) <= 64


def test_sweeping_forgets_what_has_aged_out(set_path):
    answers = Answers(set_path, lifetime_seconds=60)
    answer = answers.remember("q", None, confident())

    assert answers.sweep(0.0) == 0
    assert answers.sweep(float("inf")) == 1
    assert answers.capture(answer.token, "confident-and-wrong") == {"captured": "expired"}


def test_the_set_holds_both_halves_and_counts_them_apart(set_path, tmp_path):
    """Fixture and live in one file: two files would leave a standing question about the bar."""
    answers = Answers(set_path)
    answers.capture(answers.remember("live one", None, confident()).token, "confident-and-wrong")
    hand_written = Entry(
        query="artin wedderburn",
        shape="wrong-granularity",
        verdict="confident",
        floor=0.12,
        scores={},
        best=0.4,
        origin=FIXTURE,
        expect="/documents/wedderburn.md",
    )
    with open(set_path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(hand_written.as_json()) + "\n")

    assert counts(captured(set_path)) == {
        "total": 2,
        "fixture": 1,
        "live": 1,
        "pending": 1,
        "retired": 0,
    }
    assert by_shape(captured(set_path))["wrong-granularity"] == 1
    assert set(by_shape(captured(set_path))) == set(SHAPES)


def test_a_retired_entry_is_kept_and_left_out_of_the_scoring(set_path):
    """Retired by marking rather than deleted, so the judgement survives its subject."""
    retired = Entry(
        query="a query that was a bad test",
        shape="not-in-the-shortlist",
        verdict="ambiguous",
        floor=0.12,
        scores={},
        best=0.1,
        expect="/documents/quiver.md",
        retired=True,
    )
    with open(set_path, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(retired.as_json()) + "\n")

    assert len(captured(set_path)) == 1
    assert not captured(set_path)[0].is_scorable
    assert counts(captured(set_path))["retired"] == 1
