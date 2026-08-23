"""The fingerprint is only useful if it is stable and if it moves when the stack moves."""

from __future__ import annotations

from syrax_search.fingerprint import fingerprint


def test_it_is_the_same_twice(embedder):
    assert fingerprint(embedder) == fingerprint(embedder)


def test_it_crosses_several_window_boundaries(embedder):
    """A sample that fits in one window would report nothing about where boundaries fall."""
    assert fingerprint(embedder)["windows"] > 5


def test_a_moved_boundary_moves_the_fingerprint(embedder, monkeypatch):
    """The whole point: a tokenizer whose windows shift is what this exists to catch."""
    import syrax_search.chunking as chunking

    before = fingerprint(embedder)
    monkeypatch.setattr(chunking, "WINDOW_TOKENS", chunking.WINDOW_TOKENS // 2)
    after = fingerprint(embedder)
    assert after["boundaries"] != before["boundaries"]
    assert after["windows"] != before["windows"]
