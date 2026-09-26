"""The shared model's lifecycle, exercised without loading the real export."""

from __future__ import annotations

import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import numpy as np
import pytest

from syrax_search.embedder import MODEL_FILE, TOKENIZER_FILE, PinnedEmbedder


@pytest.fixture
def runtime(tmp_path, monkeypatch):
    for name in (MODEL_FILE, TOKENIZER_FILE):
        (tmp_path / name).touch()
    state = SimpleNamespace(
        sessions=0,
        active=0,
        peak=0,
        started=threading.Event(),
        finish=threading.Event(),
        fail_tokenizer=False,
    )

    class Tokenizer:
        @classmethod
        def from_file(cls, path):
            if state.fail_tokenizer:
                state.fail_tokenizer = False
                raise ValueError("synthetic tokenizer load failure")
            return cls()

        def enable_padding(self, **kwargs):
            pass

        def enable_truncation(self, **kwargs):
            pass

        def encode_batch(self, texts):
            return [SimpleNamespace(ids=[1], attention_mask=[1]) for _ in texts]

    class Session:
        def __init__(self, *args, **kwargs):
            state.sessions += 1

        def run(self, outputs, inputs):
            state.active += 1
            state.peak = max(state.peak, state.active)
            state.started.set()
            assert state.finish.wait(5), "test did not release synthetic inference"
            state.active -= 1
            return [np.ones((len(inputs["input_ids"]), 768), dtype=np.float32)]

    monkeypatch.setitem(
        sys.modules,
        "onnxruntime",
        SimpleNamespace(SessionOptions=SimpleNamespace, InferenceSession=Session),
    )
    monkeypatch.setitem(sys.modules, "tokenizers", SimpleNamespace(Tokenizer=Tokenizer))
    return PinnedEmbedder(str(tmp_path), 0), state


def test_queries_and_index_batches_share_one_serial_model(runtime):
    pinned, state = runtime
    attempted = threading.Event()

    def documents():
        attempted.set()
        return pinned.embed_documents(["synthetic document"])

    with ThreadPoolExecutor(max_workers=2) as workers:
        query = workers.submit(pinned.embed_query, "synthetic query")
        assert state.started.wait(5)
        batch = workers.submit(documents)
        assert attempted.wait(5)
        try:
            assert not pinned.release_if_idle(), "in-flight inference is not idle"
        finally:
            state.finish.set()
        assert query.result(timeout=5).shape == (768,)
        assert batch.result(timeout=5).shape == (1, 768)
    assert state.sessions == 1
    assert state.peak == 1
    assert pinned.release_if_idle()
    assert not pinned.release_if_idle()


def test_a_failed_load_does_not_publish_a_partial_model(runtime):
    pinned, state = runtime
    state.fail_tokenizer = True
    with pytest.raises(ValueError, match="synthetic tokenizer load failure"):
        pinned.embed_query("first attempt")
    state.finish.set()
    assert pinned.embed_query("retry").shape == (768,)
    assert state.sessions == 2
