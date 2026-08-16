"""PROTOTYPE — wipe me. Ticket #34: what does each EmbeddingGemma quantisation cost?

RAM is the binding constraint, so measure resident size after a REAL inference at a
realistic sequence length - an arena grows with the longest input it has seen, so a
short warm-up understates it.
"""

import os
import resource
import subprocess
import sys
import time

VARIANTS = [
    "model_quantized",   # int8 - the one the trial used
    "model_q4",
    "model_q4f16",
    "model_no_gather_q4",
    "model_fp16",
]


def measure(variant):
    """Run in a fresh process: RSS is a high-water mark and does not come back down."""
    code = f'''
import os, resource, time, numpy as np
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from tokenizers import Tokenizer
repo = "onnx-community/embeddinggemma-300m-ONNX"
base = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1e6
p = hf_hub_download(repo, "onnx/{variant}.onnx")
try:
    hf_hub_download(repo, "onnx/{variant}.onnx_data")
except Exception:
    pass
mb = os.path.getsize(p)/1e6
d = os.path.dirname(p)
for f in os.listdir(d):
    if f.startswith("{variant}") and f.endswith(".onnx_data"):
        mb += os.path.getsize(os.path.join(d, f))/1e6
o = ort.SessionOptions(); o.intra_op_num_threads = 8
s = ort.InferenceSession(p, o, providers=["CPUExecutionProvider"])
tok = Tokenizer.from_file(hf_hub_download(repo, "tokenizer.json"))
tok.enable_padding(pad_id=0, pad_token="<pad>"); tok.enable_truncation(max_length=1024)
# a realistic indexing batch: 32 chunks of ~480 tokens
long_text = "algebra " * 470
enc = tok.encode_batch(["title: none | text: " + long_text] * 8)
ids = np.array([e.ids for e in enc], dtype=np.int64)
am = np.array([e.attention_mask for e in enc], dtype=np.int64)
t = time.perf_counter()
s.run(["sentence_embedding"], {{"input_ids": ids, "attention_mask": am}})
batch_ms = (time.perf_counter()-t)*1000
q = tok.encode_batch(["task: search result | query: what was the theorem about simple matrix algebras"])
qi = np.array([e.ids for e in q], dtype=np.int64); qa = np.array([e.attention_mask for e in q], dtype=np.int64)
s.run(["sentence_embedding"], {{"input_ids": qi, "attention_mask": qa}})
t = time.perf_counter()
s.run(["sentence_embedding"], {{"input_ids": qi, "attention_mask": qa}})
query_ms = (time.perf_counter()-t)*1000
rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1e6 - base
print(f"RESULT|{variant}|{{mb:.0f}}|{{rss:.0f}}|{{batch_ms/8:.0f}}|{{query_ms:.0f}}")
'''
    env = dict(os.environ, HF_HOME=os.path.join(os.path.dirname(os.path.abspath(__file__)), "hf-cache"))
    r = subprocess.run(
        [os.path.join(os.path.dirname(os.path.abspath(__file__)), ".venv/bin/python"), "-c", code],
        capture_output=True, text=True, env=env, timeout=3600,
    )
    for line in r.stdout.splitlines():
        if line.startswith("RESULT|"):
            return line.split("|")[1:]
    print(f"  {variant}: FAILED\n{r.stderr[-400:]}")
    return None


print(f"{'variant':<22}{'disk MB':>9}{'RSS MB':>9}{'ms/chunk':>10}{'query ms':>10}")
for v in VARIANTS:
    got = measure(v)
    if got:
        name, mb, rss, per, q = got
        print(f"{name:<22}{mb:>9}{rss:>9}{per:>10}{q:>10}", flush=True)
