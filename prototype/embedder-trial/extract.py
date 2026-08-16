"""PROTOTYPE — wipe me. Ticket #34: extract + chunk one folder of the corpus.

Applies #16's walk rules (no symlink following, rejected patterns, content-hash
dedup) and writes docs + chunks to corpus.sqlite. Chunking uses ONE tokenizer for
all three embedders so the trial compares models, not chunk boundaries.
"""

import hashlib
import os
import sqlite3
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor

ROOT = "/Volumes/RAID0/My Drive/Modules/Research/Odyssey Y1"
DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "corpus.sqlite")

# #16's rejected patterns, plus LaTeX build artefacts this corpus actually contains.
REJECT_DIRS = {
    "node_modules", ".git", "dist", "build", ".venv", "vendor",
    "site-packages", ".data", "tmp",
}
REJECT_EXT = {
    ".aux", ".log", ".out", ".fls", ".fdb_latexmk", ".synctex", ".gz",
    ".toc", ".nav", ".snm", ".vrb", ".bbl", ".blg", ".pem", ".crt",
}
TEXT_EXT = {".md", ".txt", ".tex", ".bib", ".csv", ".json", ".jsonl", ".yaml", ".yml"}
PDF_EXT = {".pdf"}

CHUNK_TOKENS = 480       # 512 window less room for a model's prompt prefix
OVERLAP_TOKENS = 72      # ~15%


def rejected(path: str, name: str) -> str | None:
    if name.startswith("."):
        return "dotfile"
    if name.startswith("id_") or name.startswith(".env"):
        return "secret-pattern"
    ext = os.path.splitext(name)[1].lower()
    if ext in REJECT_EXT:
        return f"build-artefact{ext}"
    return None


def walk():
    """os.walk with followlinks=False, and symlinked files skipped outright."""
    for dirpath, dirnames, filenames in os.walk(ROOT, followlinks=False):
        dirnames[:] = [
            d for d in dirnames
            if d not in REJECT_DIRS
            and not d.startswith(".")
            and not os.path.islink(os.path.join(dirpath, d))
        ]
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            if os.path.islink(full):
                continue
            reason = rejected(full, fn)
            yield full, fn, reason


def extract_one(args):
    full, fn = args
    ext = os.path.splitext(fn)[1].lower()
    t0 = time.perf_counter()
    try:
        if ext in PDF_EXT:
            r = subprocess.run(
                ["pdftotext", "-q", "-enc", "UTF-8", full, "-"],
                capture_output=True, timeout=180,
            )
            text = r.stdout.decode("utf-8", "replace")
        elif ext in TEXT_EXT:
            with open(full, "rb") as f:
                text = f.read().decode("utf-8", "replace")
        else:
            return full, None, "filename-only", 0.0
    except Exception as e:  # noqa: BLE001 - prototype
        return full, None, f"error:{type(e).__name__}", time.perf_counter() - t0
    dt = time.perf_counter() - t0
    if len(text.strip()) < 32:
        return full, "", "no-text-layer", dt
    return full, text, "ok", dt


def main():
    con = sqlite3.connect(DB)
    con.executescript("""
        DROP TABLE IF EXISTS docs; DROP TABLE IF EXISTS chunks;
        CREATE TABLE docs(
            id INTEGER PRIMARY KEY, path TEXT, name TEXT, ext TEXT, bytes INTEGER,
            status TEXT, n_chars INTEGER, text_sha TEXT, secs REAL);
        CREATE TABLE chunks(
            id INTEGER PRIMARY KEY, doc_id INTEGER, ord INTEGER,
            text TEXT, n_tokens INTEGER);
    """)

    candidates, skipped = [], []
    for full, fn, reason in walk():
        (skipped if reason else candidates).append((full, fn, reason))
    print(f"walk: {len(candidates)} candidates, {len(skipped)} rejected", flush=True)

    t0 = time.perf_counter()
    with ProcessPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(extract_one, [(f, n) for f, n, _ in candidates], chunksize=4))
    wall = time.perf_counter() - t0
    print(f"extract: {wall:.1f}s wall for {len(results)} files", flush=True)

    from tokenizers import Tokenizer
    tok = Tokenizer.from_pretrained("BAAI/bge-small-en-v1.5")

    seen_hashes: dict[str, str] = {}
    doc_id = 0
    chunk_id = 0
    stats = {"ok": 0, "dedup": 0, "no-text-layer": 0, "filename-only": 0, "error": 0}
    step = CHUNK_TOKENS - OVERLAP_TOKENS

    for (full, text, status, secs), (_, fn, _) in zip(results, candidates):
        ext = os.path.splitext(fn)[1].lower()
        size = os.path.getsize(full)
        if text:
            sha = hashlib.sha256(text.encode()).hexdigest()
            if sha in seen_hashes:
                status = "dedup"
                stats["dedup"] += 1
                text = None
            else:
                seen_hashes[sha] = full
        else:
            sha = None
        stats[status.split(":")[0]] = stats.get(status.split(":")[0], 0) + (0 if status == "dedup" else 1)

        doc_id += 1
        con.execute(
            "INSERT INTO docs VALUES(?,?,?,?,?,?,?,?,?)",
            (doc_id, full, fn, ext, size, status, len(text or ""), sha, secs),
        )
        if status != "ok" or not text:
            continue

        ids = tok.encode(text, add_special_tokens=False).ids
        for start in range(0, max(len(ids), 1), step):
            window = ids[start:start + CHUNK_TOKENS]
            if not window:
                break
            piece = tok.decode(window)
            if len(piece.strip()) < 32:
                continue
            chunk_id += 1
            con.execute(
                "INSERT INTO chunks VALUES(?,?,?,?,?)",
                (chunk_id, doc_id, start // step, piece, len(window)),
            )
            if start + CHUNK_TOKENS >= len(ids):
                break

    con.commit()
    print(f"docs={doc_id} chunks={chunk_id} stats={stats}", flush=True)
    print("extract wall secs:", round(wall, 1))
    con.close()


if __name__ == "__main__":
    sys.exit(main())
