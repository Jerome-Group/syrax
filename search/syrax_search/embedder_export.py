"""Fetching the pinned export — the one step in this unit that is allowed to reach a network.

It is a command a person runs, not something the index or a query can trigger, which is what makes
"nothing in the pipeline touches a network" a property rather than a hope. `PinnedEmbedder` opens
files and raises if they are missing; it never fetches.

The mirror rather than the source repository is deliberate: `google/embeddinggemma-300m` is gated,
so its tokenizer 401s without an accepted licence and a token, and an unattended machine cannot
answer that. `onnx-community` carries the same `tokenizer.json` ungated.
"""

from __future__ import annotations

import os
import shutil

REPOSITORY = "onnx-community/embeddinggemma-300m-ONNX"
FILES = ("onnx/model_q4.onnx", "tokenizer.json")
# Present only for the exports whose weights exceed protobuf's 2 GB limit, so its absence is normal.
OPTIONAL = ("onnx/model_q4.onnx_data",)


def fetch(destination: str) -> list[str]:
    """The pinned files, flattened into one directory the embedder opens by name."""
    from huggingface_hub import hf_hub_download

    os.makedirs(destination, exist_ok=True)
    written = []
    for name in FILES + OPTIONAL:
        try:
            downloaded = hf_hub_download(REPOSITORY, name)
        except Exception:
            if name in OPTIONAL:
                continue
            raise
        placed = os.path.join(destination, os.path.basename(name))
        shutil.copyfile(downloaded, placed)
        written.append(placed)
    return written
