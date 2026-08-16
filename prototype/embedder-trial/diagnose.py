"""PROTOTYPE — wipe me. Ticket #34: is a miss the embedder's fault or the ranking's?

For each benchmark query, brute-force cosine over EVERY chunk and report where the
expected document's best chunk actually sits. If it ranks well by raw cosine but
loses after collapse, the embedder found it and the ranking lost it.
"""

import json
import os
import sqlite3
import sys

import numpy as np
import sqlite_vec

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "corpus.sqlite")
ROOT = "/Volumes/RAID0/My Drive/Modules/Research/Odyssey Y1/"
BENCH = "/Volumes/RAID0/104 Syrax/benchmark/retrieval-eval.jsonl"


def main(name):
    con = sqlite3.connect(CORPUS)
    paths = dict(con.execute("SELECT id, path FROM docs").fetchall())
    chunk_doc = dict(con.execute("SELECT id, doc_id FROM chunks").fetchall())
    n_chunks = dict(con.execute("SELECT doc_id, count(*) FROM chunks GROUP BY doc_id").fetchall())

    vdb = sqlite3.connect(os.path.join(HERE, f"index_{name}.sqlite"))
    vdb.enable_load_extension(True)
    sqlite_vec.load(vdb)
    vdb.enable_load_extension(False)
    dim = vdb.execute("SELECT dim FROM meta").fetchone()[0]

    rows = vdb.execute("SELECT chunk_id, emb FROM vec ORDER BY chunk_id").fetchall()
    ids = np.array([r[0] for r in rows])
    M = np.vstack([np.frombuffer(r[1], dtype=np.float32) for r in rows])
    print(f"{name}: matrix {M.shape}")

    sys.path.insert(0, HERE)
    from embed import LOADERS, norm
    encode, _ = LOADERS[name]()

    bench = [json.loads(l) for l in open(BENCH) if l.strip()]
    print(f"\n{'id':<5}{'kind':<20}{'best-chunk rank':>16}  {'cos':>7}  {'doc chunks':>10}  winner")
    for b in bench:
        if not b["expect"]:
            continue
        q = norm(encode([b["query"]], is_query=True))[0]
        sims = M @ q
        order = np.argsort(-sims)

        want = {d for d, p in paths.items()
                if any(p.replace(ROOT, "").startswith(e) for e in b["expect"])}

        rank_of_expected = None
        for i, idx in enumerate(order):
            if chunk_doc[int(ids[idx])] in want:
                rank_of_expected = i + 1
                cos_expected = float(sims[idx])
                break

        win_doc = chunk_doc[int(ids[order[0]])]
        print(
            f"{b['id']:<5}{b['kind']:<20}{str(rank_of_expected):>16}  "
            f"{cos_expected:>7.3f}  {max(n_chunks.get(d,0) for d in want):>10}  "
            f"{paths[win_doc].replace(ROOT,'')[:52]} ({n_chunks.get(win_doc,0)} chunks)"
        )


if __name__ == "__main__":
    main(sys.argv[1])
