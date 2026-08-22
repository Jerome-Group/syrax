"""The pinned export itself, where the export is on the machine.

These skip in CI on purpose — the suite runs against a stand-in embedder so nobody has to download
698 MB to run it — and that is exactly why this file exists. The stand-in cannot pad or truncate,
so the one bug this module has actually had was invisible to every test that used it.
"""

from __future__ import annotations

import importlib.util
import os

import pytest

from syrax_search.chunking import WINDOW_TOKENS, chunk
from syrax_search.config import EMBEDDER_DIRECTORY
from syrax_search.embedder import MAXIMUM_INPUT_TOKENS, MODEL_FILE, PinnedEmbedder

EXPORT = os.environ.get("SYRAX_SEARCH_INDEX")


def _runnable() -> bool:
    """The export and what opens it: `requirements-dev.txt` deliberately installs neither."""
    if EXPORT is None or not os.path.exists(os.path.join(EXPORT, EMBEDDER_DIRECTORY, MODEL_FILE)):
        return False
    return all(importlib.util.find_spec(one) for one in ("onnxruntime", "tokenizers"))


pytestmark = pytest.mark.skipif(
    not _runnable(), reason="the pinned export is not on this machine (set SYRAX_SEARCH_INDEX)"
)


@pytest.fixture
def pinned() -> PinnedEmbedder:
    return PinnedEmbedder(os.path.join(EXPORT, EMBEDDER_DIRECTORY), 1800)


def test_a_long_document_is_windowed_whole(pinned):
    """Truncation is state on the tokenizer, so a shared one silently indexes only front matter."""
    text = "the quick brown fox jumps over the lazy dog " * 20_000
    tokenizer = pinned.tokenizer()

    assert len(tokenizer.encode_ids(text)) > MAXIMUM_INPUT_TOKENS * 100
    windows = list(chunk(text, tokenizer))
    assert len(windows) > 400
    assert all(one.tokens <= WINDOW_TOKENS for one in windows)


def test_a_query_and_a_document_are_embedded_into_the_same_space(pinned):
    query = pinned.embed_query("what does the fox do")
    documents = pinned.embed_documents(["the quick brown fox jumps", "an unrelated note on tides"])
    assert query.shape == (pinned.dimensions,)
    assert float(documents[0] @ query) > float(documents[1] @ query)
