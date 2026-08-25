"""A fixture corpus and a stand-in embedder, so the verdict can be tested without 698 MB of weights.

The stub is not a mock that returns scripted answers: it is a real bag-of-words embedding over unit
vectors, so `1 - distance` behaves the way the pinned model's does — a document that shares the
query's words scores high and one that shares none lands below the empty floor. That is what makes
a verdict test mean something.

It shares the floors with the real index rather than having its own, so **a query here is chosen
for where its score falls against them**. At the floor ADR-0025 re-fitted, sharing a couple of words
with a ten-word document is `empty` and not a shortlist, which is why the shortlist query names most
of one document and part of another. A floor that moves again moves these queries with it.
"""

from __future__ import annotations

import json
import os
import zlib

import numpy as np
import pytest

from syrax_search.config import read_deployment
from syrax_search.embedder import DIMENSIONS, normalise


class StubTokenizer:
    """Words in, words out — the chunker only needs a reversible split."""

    def __init__(self) -> None:
        self._vocabulary: list[str] = []
        self._positions: dict[str, int] = {}

    def encode_ids(self, text: str) -> list[int]:
        ids = []
        for word in text.split():
            if word not in self._positions:
                self._positions[word] = len(self._vocabulary)
                self._vocabulary.append(word)
            ids.append(self._positions[word])
        return ids

    def decode(self, ids: list[int]) -> str:
        return " ".join(self._vocabulary[one] for one in ids)


class StubEmbedder:
    dimensions = DIMENSIONS

    def __init__(self) -> None:
        self._tokenizer = StubTokenizer()
        self.released = 0

    def tokenizer(self) -> StubTokenizer:
        return self._tokenizer

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        return normalise(np.array([self._bag(text) for text in texts], dtype=np.float32))

    def embed_query(self, text: str) -> np.ndarray:
        return normalise(np.array(self._bag(text), dtype=np.float32))

    def release_if_idle(self) -> bool:
        self.released += 1
        return True

    def _bag(self, text: str) -> np.ndarray:
        """A stable hash, so a failing verdict reproduces on the next run."""
        vector = np.zeros(DIMENSIONS, dtype=np.float32)
        for word in _words(text):
            vector[zlib.crc32(word.encode()) % DIMENSIONS] += 1.0
        return vector


def _words(text: str) -> list[str]:
    return ["".join(c for c in word if c.isalnum()).lower() for word in text.split()]


CORPUS = {
    "notes/wedderburn.md": (
        "artin wedderburn theorem semisimple rings decompose matrix algebras division rings "
        "structure classification"
    ),
    "notes/quiver.md": (
        "quiver representations path algebra gabriel theorem dynkin diagrams indecomposable modules"
    ),
    "notes/rowing.md": "rowing erg splits stroke rate technique catch drive finish recovery",
    # A year in its name and nowhere in its body: the only way to reach it is to spell the year.
    "notes/exam 2025-2026 semester 2.md": (
        "past year paper questions covering continuity differentiability and integration"
    ),
    # The shape a scan takes in the index, and the one the fusion loses. Its name accounts for the
    # whole of `mh1300 midterm 2025`; its body is what an OCR pass got off a photographed page, so
    # it reaches neither the text arm nor the vector arm with anything.
    "notes/mh1300 midterm 2025 questions.md": (
        "photographed pages tilted in the frame with smudged margins mostly unreadable"
    ),
    # Bookkeeping rather than documents, and the reason a shortlist fills up with them: each names
    # every paper a module has, so both hit the text arm and the vector arm for any query about one.
    # Their own names account for a third of such a query at most, which is under the majority the
    # exemption asks for — so they are fused hits and never named ones, which is the whole of the
    # asymmetry #187 is about. Two of them, because in the corpus this was measured against there
    # were four, and one alone leaves the ranking too easy to read as a tie.
    "notes/mh1300 register.md": (
        "curated source ntulearn destination assessments midterms mh1300 midterm 2025 questions "
        "mh1300 midterm 2024 solutions decided precedent digest superseded parked"
    ),
    "notes/mh2100 register.md": (
        "curated source drive destination learning past papers mh1300 midterm 2025 solutions "
        "mh2100 midterm 2025 questions decided procedure digest withdrawn appended"
    ),
    "scanned/hardware store receipt.pdf": None,
}

# Counted from the corpus rather than written beside it: a document added for one verdict's sake
# should not send somebody hunting through three pass assertions for the number that moved.
EXTRACTED = len([one for one in CORPUS if one.startswith("notes/")])
"""Inside `extractionScope` **and yielding text**, which is not the same as being inside it.

The two come apart for a document written to be unreadable, which is a thing a verdict fixture wants
— a body of one word extracts to nothing, lands in the failure ledger as `empty`, and is then seen
without being extracted. The scan below is worded to stay above that line for exactly this reason.
Give a `notes/` entry a body too slight to read and this count is wrong, and it is `test_building`
rather than the test you were writing that says so.
"""

SEEN = len(CORPUS)
"""Named, which the PDF outside the scope is too."""


@pytest.fixture
def machine(tmp_path):
    """One deployment: an allowlist root, a narrower scope, and trees neither reaches."""
    documents = tmp_path / "documents"
    for relative, text in CORPUS.items():
        path = documents / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"%PDF-1.4 not really" if text is None else text.encode())

    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "letter.md").write_text("a letter that no allowlist root reaches " * 3)

    private = tmp_path / "private"
    private.mkdir()
    (private / "diary.md").write_text("what the blocklist forbids everywhere on the machine " * 3)

    deployment = tmp_path / "deployment.json"
    deployment.write_text(
        json.dumps(
            {
                "searchIndex": str(tmp_path / "index"),
                "stateDir": str(tmp_path / "runtime-state"),
                "indexAllowlist": [str(documents)],
                "extractionScope": [str(documents / "notes")],
                "blocklist": [str(private)],
                "searchScopes": {"notes": str(documents / "notes")},
            }
        )
    )
    return read_deployment(str(deployment))


@pytest.fixture
def embedder() -> StubEmbedder:
    return StubEmbedder()


def path_of(config, relative: str) -> str:
    return os.path.join(config.lists.index_allowlist[0], relative)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
