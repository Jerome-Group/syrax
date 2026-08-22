"""The pinned embedder, loaded from a local export and dropped again when search goes quiet.

`EmbeddingGemma-300M` in the `model_q4` ONNX export is pinned by measurement rather than by
preference (ADR-0004): it reaches 10 of 14 where the light candidate reaches 6, and the obvious
int8 export is both the heaviest and the slowest of the five because its weights are dequantised to
fp32 to compute.

Two properties are load-bearing and are enforced here rather than assumed. **The pipeline never
reaches a network**: the session is opened over files in one directory, and a missing file is an
error naming the one command that fetches them rather than a download. And **the model is not
resident around the clock**: it is held while search is being used and released after an idle
window, which costs the 2.27 s load on the first search after a gap and gives back 698 MB on a
16 GB machine for the twenty-three hours nobody searches.
"""

from __future__ import annotations

import os
import time
from typing import Protocol

import numpy as np

# The model's own prompts. A document embedded with the query prompt lands somewhere else entirely.
DOCUMENT_PROMPT = "title: none | text: {}"
QUERY_PROMPT = "task: search result | query: {}"

MODEL_FILE = "model_q4.onnx"
TOKENIZER_FILE = "tokenizer.json"
MAXIMUM_QUERY_TOKENS = 1024
DIMENSIONS = 768
THREADS = 8


class Embedder(Protocol):
    dimensions: int

    def tokenizer(self) -> object: ...

    def embed_documents(self, texts: list[str]) -> np.ndarray: ...

    def embed_query(self, text: str) -> np.ndarray: ...

    def release_if_idle(self) -> bool: ...


class MissingExport(Exception):
    pass


class PinnedEmbedder:
    """The pinned export, held across calls and released after `idle_evict_seconds` of quiet."""

    dimensions = DIMENSIONS

    def __init__(self, root: str, idle_evict_seconds: int) -> None:
        self._root = root
        self._idle_evict_seconds = idle_evict_seconds
        self._session: object | None = None
        self._tokenizer: object | None = None
        self._last_used = 0.0

    def tokenizer(self) -> object:
        self._load()
        return _Windows(self._tokenizer)

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        return self._encode([DOCUMENT_PROMPT.format(text) for text in texts])

    def embed_query(self, text: str) -> np.ndarray:
        return self._encode([QUERY_PROMPT.format(text)])[0]

    def release_if_idle(self) -> bool:
        """Drop the session if nothing has used it lately. Called by the server's idle sweep."""
        if self._session is None:
            return False
        if time.monotonic() - self._last_used < self._idle_evict_seconds:
            return False
        self._session = None
        self._tokenizer = None
        return True

    def _encode(self, prompted: list[str]) -> np.ndarray:
        self._load()
        encoded = self._tokenizer.encode_batch(prompted)
        ids = np.array([one.ids for one in encoded], dtype=np.int64)
        mask = np.array([one.attention_mask for one in encoded], dtype=np.int64)
        embedded = self._session.run(
            ["sentence_embedding"], {"input_ids": ids, "attention_mask": mask}
        )[0]
        self._last_used = time.monotonic()
        return normalise(embedded.astype(np.float32))

    def _load(self) -> None:
        if self._session is not None:
            self._last_used = time.monotonic()
            return
        model = os.path.join(self._root, MODEL_FILE)
        tokenizer = os.path.join(self._root, TOKENIZER_FILE)
        for required in (model, tokenizer):
            if not os.path.exists(required):
                raise MissingExport(
                    f"{required} is not there. The export is fetched once, deliberately, by "
                    "`python -m syrax_search fetch-embedder <deployment.json>`; nothing in the "
                    "index or query path reaches a network."
                )
        import onnxruntime
        from tokenizers import Tokenizer

        options = onnxruntime.SessionOptions()
        options.intra_op_num_threads = THREADS
        self._session = onnxruntime.InferenceSession(
            model, options, providers=["CPUExecutionProvider"]
        )
        loaded = Tokenizer.from_file(tokenizer)
        loaded.enable_padding(pad_id=0, pad_token="<pad>")
        loaded.enable_truncation(max_length=MAXIMUM_QUERY_TOKENS)
        self._tokenizer = loaded
        self._last_used = time.monotonic()


class _Windows:
    """The chunker's view of the model's tokenizer: ids in, text back, no prompts and no padding."""

    def __init__(self, tokenizer: object) -> None:
        self._tokenizer = tokenizer

    def encode_ids(self, text: str) -> list[int]:
        return self._tokenizer.encode(text, add_special_tokens=False).ids

    def decode(self, ids: list[int]) -> str:
        return self._tokenizer.decode(ids)


def normalise(vectors: np.ndarray) -> np.ndarray:
    """Unit vectors, so what the vector arm reports is a distance between directions."""
    lengths = np.linalg.norm(vectors, axis=-1, keepdims=True)
    return vectors / np.maximum(lengths, 1e-12)
