"""PROTOTYPE — wipe me. Ticket #34: score each embedder against the benchmark.

Builds #16's shape: FTS5 keyword arm + sqlite-vec vector arm over the same chunks,
fused, collapsed to best-chunk-per-document. Reports recall, latency, and the raw
numbers behind a `confident` / `ambiguous` / `empty` verdict.
"""

import json
import os
import sqlite3
import statistics
import sys
import time

import numpy as np
import sqlite_vec

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "corpus.sqlite")
ROOT = "/Volumes/RAID0/My Drive/Modules/Research/Odyssey Y1/"
BENCH = "/Volumes/RAID0/104 Syrax/benchmark/retrieval-eval.jsonl"
K = 40          # chunks pulled from each arm before fusion
RRF_K = 60      # standard reciprocal-rank-fusion constant


# "and" and "for" survive a bare length filter and appear in every chunk, which is
# how "Dummit and Foote" ranked a poster's bibliography above the book itself.
STOP = {
    "the", "and", "for", "was", "what", "that", "with", "from", "this", "you",
    "your", "are", "how", "does", "did", "where", "which", "about", "into",
    "out", "who", "why", "when", "they", "them", "its", "has", "have", "had",
    "can", "could", "would", "should", "will", "shall", "may", "might", "must",
    "one", "two", "not", "but", "all", "any", "our", "his", "her", "their",
}


def build_fts():
    con = sqlite3.connect(CORPUS)
    have = con.execute(
        "SELECT count(*) FROM sqlite_master WHERE name='chunk_fts'"
    ).fetchone()[0]
    if not have:
        t0 = time.perf_counter()
        con.executescript("""
            CREATE VIRTUAL TABLE chunk_fts USING fts5(text, content='chunks', content_rowid='id');
            INSERT INTO chunk_fts(rowid, text) SELECT id, text FROM chunks;
            -- ADR-0004 says the keyword arm covers "the same extracted text". That omits
            -- the filename, which is where a name-the-thing query's answer actually lives.
            CREATE VIRTUAL TABLE path_fts USING fts5(rel);
        """)
        rows = con.execute("SELECT id, path FROM docs").fetchall()
        for did, p in rows:
            rel = p.replace(ROOT, "").replace("/", " ").replace("_", " ").replace(".", " ")
            con.execute("INSERT INTO path_fts(rowid, rel) VALUES(?,?)", (did, rel))
        con.commit()
        print(f"fts5 built in {time.perf_counter()-t0:.1f}s", flush=True)
    con.close()


def terms_of(q):
    toks = "".join(c if c.isalnum() else " " for c in q).lower().split()
    return [t for t in toks if len(t) > 2 and t not in STOP]


def fts_query(con, q, k=K):
    """FTS5 with the query as an OR bag of terms - a phrase match returns nothing
    on a description that shares no exact phrase with the document."""
    terms = terms_of(q)
    if not terms:
        return []
    expr = " OR ".join(f'"{t}"' for t in terms)
    rows = con.execute(
        "SELECT rowid, rank FROM chunk_fts WHERE chunk_fts MATCH ? ORDER BY rank LIMIT ?",
        (expr, k),
    ).fetchall()
    return [r[0] for r in rows]


def path_query(con, q, k=10):
    """The other half of the keyword arm: match the document's own name."""
    terms = terms_of(q)
    if not terms:
        return []
    expr = " OR ".join(f'"{t}"' for t in terms)
    rows = con.execute(
        "SELECT rowid, rank FROM path_fts WHERE path_fts MATCH ? ORDER BY rank LIMIT ?",
        (expr, k),
    ).fetchall()
    return [r[0] for r in rows]


def vec_query(vdb, qvec, k=K):
    rows = vdb.execute(
        "SELECT chunk_id, distance FROM vec WHERE emb MATCH ? AND k = ? ORDER BY distance",
        (qvec.tobytes(), k),
    ).fetchall()
    return rows


def doc_of(con, chunk_ids):
    if not chunk_ids:
        return {}
    qs = ",".join("?" * len(chunk_ids))
    return dict(con.execute(f"SELECT id, doc_id FROM chunks WHERE id IN ({qs})", chunk_ids).fetchall())


def main(name):
    build_fts()
    con = sqlite3.connect(CORPUS)
    paths = dict(con.execute("SELECT id, path FROM docs").fetchall())

    vdb = sqlite3.connect(os.path.join(HERE, f"index_{name}.sqlite"))
    vdb.enable_load_extension(True)
    sqlite_vec.load(vdb)
    vdb.enable_load_extension(False)
    meta = vdb.execute("SELECT name, dim, load_secs, embed_secs, n FROM meta").fetchone()

    sys.path.insert(0, HERE)
    from embed import LOADERS, norm
    encode, _ = LOADERS[name]()

    bench = [json.loads(l) for l in open(BENCH) if l.strip()]
    results, latencies = [], []

    for b in bench:
        t0 = time.perf_counter()
        qv = norm(encode([b["query"]], is_query=True))[0]
        t_embed = time.perf_counter() - t0

        t1 = time.perf_counter()
        v_hits = vec_query(vdb, qv)
        f_hits = fts_query(con, b["query"])
        p_hits = path_query(con, b["query"])
        t_search = time.perf_counter() - t1

        # rank -> doc, keeping the best (first) chunk per document in each arm
        c2d = doc_of(con, [c for c, _ in v_hits] + f_hits)
        v_docs, f_docs = [], []
        for c, dist in v_hits:
            d = c2d.get(c)
            if d and d not in v_docs:
                v_docs.append(d)
        for c in f_hits:
            d = c2d.get(c)
            if d and d not in f_docs:
                f_docs.append(d)
        # the keyword arm is text-match fused with name-match, then treated as one arm
        kw = {}
        for r, d in enumerate(f_docs):
            kw[d] = kw.get(d, 0) + 1 / (RRF_K + r + 1)
        for r, d in enumerate(p_hits):
            kw[d] = kw.get(d, 0) + 1 / (RRF_K + r + 1)
        k_docs = [d for d, _ in sorted(kw.items(), key=lambda kv: -kv[1])]

        fused = {}
        for r, d in enumerate(v_docs):
            fused[d] = fused.get(d, 0) + 1 / (RRF_K + r + 1)
        for r, d in enumerate(k_docs):
            fused[d] = fused.get(d, 0) + 1 / (RRF_K + r + 1)
        ranked = sorted(fused.items(), key=lambda kv: -kv[1])
        f_docs = k_docs

        latencies.append((t_embed, t_search))

        def hit(doc_id):
            rel = paths[doc_id].replace(ROOT, "")
            return any(rel.startswith(e) for e in b["expect"])

        top = [d for d, _ in ranked[:5]]
        rank = next((i + 1 for i, d in enumerate([d for d, _ in ranked]) if hit(d)), None)

        # the raw numbers behind a verdict
        cos_top = 1 - v_hits[0][1] if v_hits else 0.0
        cos_2 = 1 - v_hits[1][1] if len(v_hits) > 1 else 0.0
        both_agree = bool(v_docs and f_docs and v_docs[0] == f_docs[0])
        # gap to the next DISTINCT document, not the next chunk
        top_doc = ranked[0][0] if ranked else None
        gap_doc = (ranked[0][1] - ranked[1][1]) if len(ranked) > 1 else 0.0

        results.append({
            "id": b["id"], "kind": b["kind"], "query": b["query"],
            "expect_empty": not b["expect"],
            "rank": rank,
            "top": [paths[d].replace(ROOT, "") for d in top],
            "cos_top": round(float(cos_top), 4),
            "cos_gap_chunk": round(float(cos_top - cos_2), 4),
            "rrf_gap_doc": round(float(gap_doc), 5),
            "both_arms_agree": both_agree,
            "vec_top_doc": paths[v_docs[0]].replace(ROOT, "") if v_docs else None,
            "fts_top_doc": paths[f_docs[0]].replace(ROOT, "") if f_docs else None,
            "t_embed_ms": round(t_embed * 1000, 1),
            "t_search_ms": round(t_search * 1000, 1),
        })

    answerable = [r for r in results if not r["expect_empty"]]
    r1 = sum(1 for r in answerable if r["rank"] == 1)
    r3 = sum(1 for r in answerable if r["rank"] and r["rank"] <= 3)
    mrr = statistics.mean([1 / r["rank"] if r["rank"] else 0 for r in answerable])

    out = {
        "model": meta[0], "dim": meta[1], "load_secs": round(meta[2], 1),
        "embed_secs": round(meta[3], 1), "chunks": meta[4],
        "chunks_per_sec": round(meta[4] / meta[3], 1),
        "index_mb": round(os.path.getsize(os.path.join(HERE, f"index_{name}.sqlite")) / 1e6, 1),
        "n_answerable": len(answerable),
        "recall_at_1": r1, "recall_at_3": r3, "mrr": round(mrr, 3),
        "median_query_embed_ms": round(statistics.median(l[0] for l in latencies) * 1000, 1),
        "median_search_ms": round(statistics.median(l[1] for l in latencies) * 1000, 1),
        "results": results,
    }
    with open(os.path.join(HERE, f"eval_{name}.json"), "w") as f:
        json.dump(out, f, indent=2)

    print(f"\n=== {name} (dim {meta[1]}) ===")
    print(f"index build {meta[3]:.1f}s ({meta[4]/meta[3]:.0f} chunks/s), {out['index_mb']} MB")
    print(f"recall@1 {r1}/{len(answerable)}  recall@3 {r3}/{len(answerable)}  MRR {mrr:.3f}")
    print(f"query: embed {out['median_query_embed_ms']}ms + search {out['median_search_ms']}ms")
    for r in results:
        mark = "OK " if r["rank"] == 1 else ("~  " if r["rank"] and r["rank"] <= 3 else "MISS")
        if r["expect_empty"]:
            mark = "EMPTY?"
        print(f"  {mark} {r['id']} rank={r['rank']} cos={r['cos_top']:.3f} agree={r['both_arms_agree']} | {r['top'][0] if r['top'] else '-'}")


if __name__ == "__main__":
    main(sys.argv[1])
