"""The two passes that keep the index true, and the ledger of what neither could read.

**Incremental**, hourly, compares `(path, size, mtime)` and re-extracts only mismatches. Content
hashing on this pass would mean reading ~14 GB every hour to buy correctness that only shows up
after a mass move.

Extraction runs in a process pool and embedding does not. Reading a PDF is a subprocess per
document and the wall-clock figure the freshness budget rests on — about three minutes for the
whole scope — is a parallel one; serially it is hours, and an hourly pass that takes hours is not
hourly. The embedder is already multi-threaded inside one session, and a second copy of it is
exactly what the resident unit exists to avoid.

**Full**, every third day, re-extracts everything unconditionally — which is what catches a file
that broke silently — while keying embedding on the hash of the *extracted text*, so the expensive
step still runs only on genuinely new content. A file that was corrupt last week and is fine today
is picked up even though its mtime never moved. That hash is also why OCR is affordable: a scan
whose bytes have not changed keeps the text the last pass recognised rather than being read again.
"""

from __future__ import annotations

import hashlib
import itertools
import json
import os
import sqlite3
import time
from collections.abc import Iterator
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from typing import Literal

import numpy as np

from .chunking import chunk
from .config import SearchConfig
from .embedder import Embedder
from .extraction import Extraction, extract
from .index import (
    StoredDocument,
    clear_chunks,
    document_text,
    forget_document,
    open_index,
    put_document,
    replace_chunks,
    stored_documents,
)
from .walk import Crawled, crawl

EMBED_BATCH = 32

# Wide enough to keep the pool busy, short enough that a killed pass loses one batch of reading.
EXTRACT_BATCH = 64
EXTRACT_WORKERS = 8

Pass = Literal["incremental", "full"]

INCREMENTAL: Pass = "incremental"
FULL: Pass = "full"

# Never a status a stored row carries: it is this pass declining to re-read, which is the whole of
# what the hourly one does with a document whose size and modification time have not moved.
UNCHANGED = "unchanged"

# What a document that was read successfully, or was never meant to be read, carries instead.
READ = ("ok", "ok-ocr", "filename-only")


@dataclass
class PassReport:
    kind: Pass
    seen: int = 0
    unchanged: int = 0
    extracted: int = 0
    embedded: int = 0
    forgotten: int = 0
    failures: list[dict] = field(default_factory=list)
    seconds: float = 0.0

    def as_reply(self) -> dict:
        return {
            "pass": self.kind,
            "documents": self.seen,
            "unchanged": self.unchanged,
            "extracted": self.extracted,
            "embedded": self.embedded,
            "forgotten": self.forgotten,
            "failures": len(self.failures),
            "seconds": round(self.seconds, 1),
        }


PROGRESS_EVERY = 200


def progress(report: PassReport) -> None:
    """A line the wrapper's capture can be read for, since a pass has no other surface."""
    if report.seen % PROGRESS_EVERY == 0:
        print(json.dumps(report.as_reply()), flush=True)


def run_pass(
    config: SearchConfig,
    embedder: Embedder,
    kind: Pass,
    database: sqlite3.Connection | None = None,
) -> PassReport:
    started = time.perf_counter()
    owned = database is None
    database = database if database is not None else open_index(config.database_path)
    report = PassReport(kind=kind)
    try:
        stored = stored_documents(database)
        seen: set[str] = set()
        with ProcessPoolExecutor(max_workers=EXTRACT_WORKERS) as readers:
            for batch in _batched(crawl(config.lists), EXTRACT_BATCH):
                for crawled in batch:
                    seen.add(crawled.path)
                for crawled, extraction in _read(batch, stored, kind, database, readers):
                    _absorb(
                        database, embedder, crawled, stored.get(crawled.path), extraction, report
                    )
                # A batch at a time, because a full pass is hours: a machine that goes down halfway
                # through one keeps what it had read, and the next pass starts from there.
                database.commit()
                progress(report)
        for path, document in stored.items():
            if path not in seen:
                forget_document(database, document.id)
                report.forgotten += 1
        database.commit()
        _write_ledger(config.failure_ledger_path, database, report.kind)
    finally:
        if owned:
            database.close()
    report.seconds = time.perf_counter() - started
    return report


def reset(config: SearchConfig) -> None:
    """Delete the index so the next pass rebuilds from nothing: what a changed embedder needs."""
    for suffix in ("", "-wal", "-shm"):
        path = config.database_path + suffix
        if os.path.exists(path):
            os.remove(path)


def _batched(candidates: Iterator[Crawled], size: int) -> Iterator[list[Crawled]]:
    while batch := list(itertools.islice(candidates, size)):
        yield batch


def _read(
    batch: list[Crawled],
    stored: dict[str, StoredDocument],
    kind: Pass,
    database: sqlite3.Connection,
    readers: ProcessPoolExecutor,
) -> list[tuple[Crawled, Extraction | None]]:
    """One batch's text, decided here and read in the pool.

    Every decision that needs the index — is this unchanged, was it OCR'd before — is made in this
    process, so what crosses to a worker is a path and whether it may run OCR, and nothing else.
    """
    decided: list[tuple[Crawled, Extraction | None]] = []
    positions: list[int] = []
    to_read: list[tuple[str, bool]] = []
    for position, crawled in enumerate(batch):
        already = stored.get(crawled.path)
        unchanged = _unchanged(already, crawled)
        decided.append((crawled, _without_reading(crawled, already, unchanged, kind, database)))
        if decided[position][1] is None:
            positions.append(position)
            to_read.append((crawled.path, kind == FULL))

    for position, extraction in zip(
        positions, readers.map(_read_one, to_read, chunksize=1), strict=True
    ):
        decided[position] = (batch[position], extraction)
    return decided


def _read_one(work: tuple[str, bool]) -> Extraction:
    """The one function that runs in a worker: a path in, its text or its failure out."""
    path, ocr = work
    first = extract(path)
    if first.status != "no-text-layer" or not ocr:
        return first
    recognised = extract(path, ocr=True)
    if recognised.text is None:
        return recognised
    # Marked, so the next full pass keeps this text rather than reading the scan again.
    return Extraction(recognised.text, "ok-ocr")


def _unchanged(stored: StoredDocument | None, crawled: Crawled) -> bool:
    return stored is not None and stored.size == crawled.size and stored.mtime == crawled.mtime


def _without_reading(
    crawled: Crawled,
    stored: StoredDocument | None,
    unchanged: bool,
    kind: Pass,
    database: sqlite3.Connection,
) -> Extraction | None:
    """What this document contributes when nothing has to be opened to know it."""
    if kind == INCREMENTAL and unchanged:
        return Extraction(None, UNCHANGED)
    if not crawled.extracted:
        return Extraction(None, "filename-only")
    if stored is not None and stored.status == "ok-ocr" and unchanged:
        recognised = document_text(database, crawled.path)
        if recognised:
            return Extraction(recognised, "ok-ocr")
    return None


def _absorb(
    database: sqlite3.Connection,
    embedder: Embedder,
    crawled: Crawled,
    stored: StoredDocument | None,
    extraction: Extraction,
    report: PassReport,
) -> None:
    report.seen += 1
    if extraction.status == UNCHANGED:
        report.unchanged += 1
        return

    if extraction.text is not None:
        report.extracted += 1
    if extraction.failed:
        report.failures.append({"path": crawled.path, "status": extraction.status})

    text_sha = _digest(extraction.text)
    document_id = put_document(
        database,
        path=crawled.path,
        name=os.path.basename(crawled.path),
        size=crawled.size,
        mtime=crawled.mtime,
        extracted=crawled.extracted and extraction.text is not None,
        status=extraction.status,
        text=extraction.text,
        text_sha=text_sha,
    )

    if extraction.text is None:
        clear_chunks(database, document_id)
        return
    if stored is not None and stored.text_sha == text_sha:
        return

    windows = list(chunk(extraction.text, embedder.tokenizer()))
    replace_chunks(
        database,
        document_id,
        [(one.ordinal, one.text) for one in windows],
        _embed([one.text for one in windows], embedder),
    )
    report.embedded += len(windows)


def _embed(texts: list[str], embedder: Embedder):
    if not texts:
        return None
    batches = [
        embedder.embed_documents(texts[start : start + EMBED_BATCH])
        for start in range(0, len(texts), EMBED_BATCH)
    ]
    return np.concatenate(batches) if len(batches) > 1 else batches[0]


def _digest(text: str | None) -> str | None:
    return hashlib.sha256(text.encode("utf-8")).hexdigest() if text is not None else None


def _write_ledger(path: str, database: sqlite3.Connection, kind: Pass) -> None:
    """Every document the index currently cannot read, replacing the last pass's list.

    Written from the index rather than from the pass, because the hourly one skips what has not
    moved — and a scan that failed last week is still a document search cannot see inside, whether
    or not this pass was the one that tried.
    """
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    stamped = time.time()
    placeholders = ",".join("?" * len(READ))
    failing = database.execute(
        f"SELECT path, status FROM documents WHERE status NOT IN ({placeholders}) ORDER BY path",
        READ,
    ).fetchall()
    with open(path, "w", encoding="utf-8") as handle:
        for failed, status in failing:
            handle.write(
                json.dumps({"path": failed, "status": status, "pass": kind, "at": stamped}) + "\n"
            )
