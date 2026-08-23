"""What the pinned stack turns a fixed input into, in one line, so a bump can be judged.

The suite runs against a stand-in embedder, and `requirements-dev.txt` deliberately installs
neither the export nor the runtime that opens it — so a green tick says nothing about a bump to
`tokenizers` or `onnxruntime`. This is what says something.

Two numbers, because the two libraries fail differently. **Windows** catch a tokenizer whose
boundaries moved: chunking is measured in its tokens, and ADR-0004 makes changed chunking a reason
to reset the index, so a moved boundary is hours of re-embedding rather than a version string.
**The vector checksum** catches a runtime whose arithmetic moved, which changes every stored vector
without changing a single boundary.

Identical output before and after a bump means the index is unaffected. Different output does not
mean the bump is wrong — it means it costs a rebuild, and that is a decision rather than a merge.
"""

from __future__ import annotations

import hashlib

from .chunking import chunk
from .embedder import Embedder

# Fixed and arbitrary. It only has to be long enough to cross several window boundaries and to be
# the same text on both sides of the comparison.
SAMPLE = (
    "The Artin-Wedderburn theorem states that a semisimple ring is isomorphic to a product of "
    "matrix rings over division rings. Its proof proceeds by decomposing the ring into minimal "
    "left ideals and identifying the endomorphism algebra of each isotypic component. "
) * 400


def fingerprint(embedder: Embedder) -> dict:
    windows = list(chunk(SAMPLE, embedder.tokenizer()))
    boundaries = hashlib.sha256("\x00".join(one.text for one in windows).encode()).hexdigest()
    vector = embedder.embed_query("what does the Wedderburn theorem decompose")
    checksum = hashlib.sha256(vector.round(4).tobytes()).hexdigest()
    return {
        "windows": len(windows),
        "boundaries": boundaries[:16],
        "vector": checksum[:16],
    }
