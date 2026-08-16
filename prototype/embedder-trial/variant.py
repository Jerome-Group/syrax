"""PROTOTYPE — wipe me. Ticket #34: does the ranking rule, not the embedder, cost the recall?

#16 fixed the shape as "scored per chunk and collapsed to the best chunk per document".
Two things in that shape can bury a short chapter under a 1,890-chunk textbook:
truncating the candidate pool, and giving a long document more draws. Score each
variant on the same vectors so the embedder is held constant.
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


def load(name):
    vdb = sqlite3.connect(os.path.join(HERE, f"index_{name}.sqlite"))
    vdb.enable_load_extension(True)
    sqlite_vec.load(vdb)
    vdb.enable_load_extension(False)
    rows = vdb.execute("SELECT chunk_id, emb FROM vec ORDER BY chunk_id").fetchall()
    ids = np.array([r[0] for r in rows])
    M = np.vstack([np.frombuffer(r[1], dtype=np.float32) for r in rows])
    return ids, M


def main(name):
    con = sqlite3.connect(CORPUS)
    paths = dict(con.execute("SELECT id, path FROM docs").fetchall())
    chunk_doc = dict(con.execute("SELECT id, doc_id FROM chunks").fetchall())
    n_chunks = dict(con.execute("SELECT doc_id, count(*) FROM chunks GROUP BY doc_id").fetchall())

    ids, M = load(name)
    doc_ix = np.array([chunk_doc[int(c)] for c in ids])
    docs = np.array(sorted(set(doc_ix)))
    doc_pos = {d: i for i, d in enumerate(docs)}
    lens = np.array([n_chunks.get(int(d), 1) for d in docs], dtype=np.float32)

    sys.path.insert(0, HERE)
    from embed import LOADERS, norm
    encode, _ = LOADERS[name]()

    bench = [json.loads(l) for l in open(BENCH) if l.strip()]
    answerable = [b for b in bench if b["expect"]]

    variants = {
        "V0 max-chunk (global)": lambda mx, tp3, L: mx,
        "V1 max - 0.02*log2(len)": lambda mx, tp3, L: mx - 0.02 * np.log2(L),
        "V2 max - 0.04*log2(len)": lambda mx, tp3, L: mx - 0.04 * np.log2(L),
        "V3 mean of top-3 chunks": lambda mx, tp3, L: tp3,
    }
    tally = {k: [0, 0, []] for k in variants}

    for b in answerable:
        q = norm(encode([b["query"]], is_query=True))[0]
        sims = M @ q

        mx = np.full(len(docs), -1e9, dtype=np.float32)
        top3 = np.zeros((len(docs), 3), dtype=np.float32) - 1e9
        for s, d in zip(sims, doc_ix):
            i = doc_pos[d]
            if s > top3[i, 0]:
                top3[i] = [s, top3[i, 0], top3[i, 1]]
            elif s > top3[i, 1]:
                top3[i, 1:] = [s, top3[i, 1]]
            elif s > top3[i, 2]:
                top3[i, 2] = s
        mx = top3[:, 0]
        tp3 = np.where(top3[:, 2] > -1e8, top3.mean(axis=1), mx)

        want = {doc_pos[d] for d, p in paths.items()
                if d in doc_pos and any(p.replace(ROOT, "").startswith(e) for e in b["expect"])}

        for vname, fn in variants.items():
            score = fn(mx, tp3, lens)
            order = np.argsort(-score)
            rank = next((i + 1 for i, ix in enumerate(order) if ix in want), None)
            if rank == 1:
                tally[vname][0] += 1
            if rank and rank <= 3:
                tally[vname][1] += 1
            tally[vname][2].append((b["id"], rank))

    print(f"\n=== {name}: ranking variants over {len(answerable)} answerable queries ===")
    for vname, (r1, r3, detail) in tally.items():
        misses = ",".join(i for i, r in detail if r != 1)
        print(f"  {vname:<26} recall@1 {r1:>2}/{len(answerable)}   recall@3 {r3:>2}/{len(answerable)}   not-1: {misses}")


if __name__ == "__main__":
    main(sys.argv[1])
