"""PROTOTYPE — wipe me. Ticket #34: embed the shared chunks with one of three models.

usage: python embed.py {bge|gemma|potion}

Writes index_<name>.sqlite holding a sqlite-vec vec0 table over the SAME chunks
extract.py produced, so the trial varies the model and nothing else.
"""

import os
import sqlite3
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "corpus.sqlite")
BATCH = 32

# EmbeddingGemma's documented prompts. bge-small wants its own query prefix;
# potion is a static model and takes none.
GEMMA_DOC = "title: none | text: {}"
GEMMA_QUERY = "task: search result | query: {}"
BGE_QUERY = "Represent this sentence for searching relevant passages: {}"


def load_gemma():
    import onnxruntime as ort
    from huggingface_hub import hf_hub_download
    from tokenizers import Tokenizer

    repo = "onnx-community/embeddinggemma-300m-ONNX"
    path = hf_hub_download(repo, "onnx/model_quantized.onnx")
    hf_hub_download(repo, "onnx/model_quantized.onnx_data")
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 8
    sess = ort.InferenceSession(path, opts, providers=["CPUExecutionProvider"])
    # google/embeddinggemma-300m is a GATED repo - its tokenizer 401s without an
    # accepted licence and an HF token. The onnx-community mirror carries the same
    # tokenizer.json ungated, which is what makes an unattended reindex possible.
    tok = Tokenizer.from_file(hf_hub_download(repo, "tokenizer.json"))
    tok.enable_padding(pad_id=0, pad_token="<pad>")
    tok.enable_truncation(max_length=1024)

    def encode(texts, is_query=False):
        tmpl = GEMMA_QUERY if is_query else GEMMA_DOC
        enc = tok.encode_batch([tmpl.format(t) for t in texts])
        ids = np.array([e.ids for e in enc], dtype=np.int64)
        mask = np.array([e.attention_mask for e in enc], dtype=np.int64)
        out = sess.run(["sentence_embedding"], {"input_ids": ids, "attention_mask": mask})[0]
        return out.astype(np.float32)

    return encode, 768


def load_bge():
    from fastembed import TextEmbedding

    m = TextEmbedding("BAAI/bge-small-en-v1.5", threads=8)

    def encode(texts, is_query=False):
        if is_query:
            texts = [BGE_QUERY.format(t) for t in texts]
        return np.array(list(m.embed(texts, batch_size=len(texts))), dtype=np.float32)

    return encode, 384


def load_potion():
    from model2vec import StaticModel

    m = StaticModel.from_pretrained("minishlab/potion-multilingual-128M")

    def encode(texts, is_query=False):
        return np.asarray(m.encode(texts), dtype=np.float32)

    return encode, 256


LOADERS = {"bge": load_bge, "gemma": load_gemma, "potion": load_potion}


def norm(v):
    n = np.linalg.norm(v, axis=1, keepdims=True)
    return v / np.maximum(n, 1e-12)


def main(name):
    import sqlite_vec

    t_load = time.perf_counter()
    encode, dim = LOADERS[name]()
    load_secs = time.perf_counter() - t_load
    print(f"{name}: model loaded in {load_secs:.1f}s, dim={dim}", flush=True)

    src = sqlite3.connect(CORPUS)
    rows = src.execute("SELECT id, text FROM chunks ORDER BY id").fetchall()
    src.close()
    print(f"{name}: {len(rows)} chunks", flush=True)

    out_path = os.path.join(HERE, f"index_{name}.sqlite")
    if os.path.exists(out_path):
        os.remove(out_path)
    db = sqlite3.connect(out_path)
    db.enable_load_extension(True)
    sqlite_vec.load(db)
    db.enable_load_extension(False)
    db.execute(f"CREATE VIRTUAL TABLE vec USING vec0(chunk_id INTEGER PRIMARY KEY, emb FLOAT[{dim}])")

    t0 = time.perf_counter()
    done = 0
    for i in range(0, len(rows), BATCH):
        batch = rows[i:i + BATCH]
        vecs = norm(encode([t for _, t in batch]))
        db.executemany(
            "INSERT INTO vec(chunk_id, emb) VALUES(?,?)",
            [(cid, v.tobytes()) for (cid, _), v in zip(batch, vecs)],
        )
        done += len(batch)
        if i % (BATCH * 40) == 0:
            el = time.perf_counter() - t0
            print(f"  {done}/{len(rows)}  {done/max(el,1e-9):.1f} chunks/s  {el:.0f}s", flush=True)
    db.commit()
    embed_secs = time.perf_counter() - t0

    db.execute("CREATE TABLE meta(name TEXT, dim INT, load_secs REAL, embed_secs REAL, n INT)")
    db.execute("INSERT INTO meta VALUES(?,?,?,?,?)", (name, dim, load_secs, embed_secs, len(rows)))
    db.commit()
    db.close()
    size_mb = os.path.getsize(out_path) / 1e6
    print(
        f"{name}: DONE {len(rows)} chunks in {embed_secs:.1f}s "
        f"({len(rows)/embed_secs:.1f}/s), index {size_mb:.1f} MB",
        flush=True,
    )


if __name__ == "__main__":
    main(sys.argv[1])
