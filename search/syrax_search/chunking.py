"""Fixed overlapping windows over one document's text.

ADR-0004 chose ~512 tokens at ~15% overlap and scored per chunk, against the two alternatives: one
vector per document, which averages a forty-page PDF into a point that never surfaces the phrase
inside it, and structural chunking, which needs a parser per format across a corpus that is Drive
exports, textbooks and Markdown at once.

The tokenizer is a parameter rather than an import. Windows are measured in the pinned model's own
tokens, and a test that had to load 698 MB of weights to check a boundary would not be run.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Protocol

# 512 less room for the model's own document prompt, which is prepended after chunking.
WINDOW_TOKENS = 480
OVERLAP_TOKENS = 72

# Below this a window is whitespace and page furniture, and it dilutes the arm it lands in.
USABLE_CHARACTERS = 32


class Tokenizer(Protocol):
    def encode_ids(self, text: str) -> list[int]: ...

    def decode(self, ids: list[int]) -> str: ...


@dataclass(frozen=True)
class Chunk:
    ordinal: int
    text: str
    tokens: int


def chunk(text: str, tokenizer: Tokenizer) -> Iterator[Chunk]:
    ids = tokenizer.encode_ids(text)
    step = WINDOW_TOKENS - OVERLAP_TOKENS
    ordinal = 0
    for start in range(0, max(len(ids), 1), step):
        window = ids[start : start + WINDOW_TOKENS]
        if not window:
            return
        piece = tokenizer.decode(window)
        if len(piece.strip()) >= USABLE_CHARACTERS:
            yield Chunk(ordinal=ordinal, text=piece, tokens=len(window))
            ordinal += 1
        if start + WINDOW_TOKENS >= len(ids):
            return
