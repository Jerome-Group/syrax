"""The one SQLite file, carrying both arms over the same extracted text.

FTS5 is the keyword arm and `sqlite-vec` the vector arm, in one database rather than two stores.
That is what makes fusion a join and scoped search a `WHERE` clause on the path — "the same
retrieval with a restriction, not a second system" — instead of a reconciliation across engines
that rank on incomparable scales (ADR-0004).

The keyword arm has two halves. `chunk_fts` carries the windows; `name_fts` carries the document's
own name and the path words above it, which is where a query that names its target actually
matches — *Dummit and Foote* returned a poster's bibliography until the book's filename was in an
index at all.
"""

from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass

import numpy as np
import sqlite_vec

from .embedder import DIMENSIONS

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS documents(
    id        INTEGER PRIMARY KEY,
    path      TEXT NOT NULL UNIQUE,
    name      TEXT NOT NULL,
    size      INTEGER NOT NULL,
    mtime     REAL NOT NULL,
    extracted INTEGER NOT NULL,
    status    TEXT NOT NULL,
    text      TEXT,
    text_sha  TEXT
);
CREATE TABLE IF NOT EXISTS chunks(
    id          INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    ordinal     INTEGER NOT NULL,
    text        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_by_document ON chunks(document_id);
CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(text, content='chunks', content_rowid='id');
CREATE VIRTUAL TABLE IF NOT EXISTS name_fts USING fts5(name);
CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors
    USING vec0(chunk_id INTEGER PRIMARY KEY, embedding FLOAT[{DIMENSIONS}]);
"""


@dataclass(frozen=True)
class StoredDocument:
    id: int
    path: str
    name: str
    size: int
    mtime: float
    status: str
    text_sha: str | None


def open_index(path: str) -> sqlite3.Connection:
    """The database with the vector extension loaded, created if this is the first pass.

    Two things share this file: the server answering queries and an index pass writing in a worker
    thread. So it is opened across threads — the server serialises its own use behind one lock, and
    the pass holds a connection of its own — and in WAL, so a three-hour re-embed does not block a
    search for three hours.
    """
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    database = sqlite3.connect(path, check_same_thread=False)
    database.execute("PRAGMA journal_mode = WAL")
    database.execute("PRAGMA foreign_keys = ON")
    database.enable_load_extension(True)
    sqlite_vec.load(database)
    database.enable_load_extension(False)
    database.executescript(SCHEMA)
    return database


def stored_documents(database: sqlite3.Connection) -> dict[str, StoredDocument]:
    rows = database.execute(
        "SELECT id, path, name, size, mtime, status, text_sha FROM documents"
    ).fetchall()
    return {row[1]: StoredDocument(*row) for row in rows}


def document_text(database: sqlite3.Connection, path: str) -> str | None:
    row = database.execute("SELECT text FROM documents WHERE path = ?", (path,)).fetchone()
    return row[0] if row else None


def put_document(
    database: sqlite3.Connection,
    *,
    path: str,
    name: str,
    size: int,
    mtime: float,
    extracted: bool,
    status: str,
    text: str | None,
    text_sha: str | None,
) -> int:
    """One document's row and its name-arm entry, replacing whatever was there under that path."""
    database.execute(
        """
        INSERT INTO documents(path, name, size, mtime, extracted, status, text, text_sha)
        VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(path) DO UPDATE SET
            name=excluded.name, size=excluded.size, mtime=excluded.mtime,
            extracted=excluded.extracted, status=excluded.status,
            text=excluded.text, text_sha=excluded.text_sha
        """,
        (path, name, size, mtime, int(extracted), status, text, text_sha),
    )
    document_id = database.execute("SELECT id FROM documents WHERE path = ?", (path,)).fetchone()[0]
    database.execute("DELETE FROM name_fts WHERE rowid = ?", (document_id,))
    database.execute("INSERT INTO name_fts(rowid, name) VALUES(?,?)", (document_id, _words(path)))
    return document_id


def replace_chunks(
    database: sqlite3.Connection,
    document_id: int,
    chunks: list[tuple[int, str]],
    embeddings: np.ndarray | None,
) -> None:
    """Every window of one document and its vectors, atomically swapped for the previous set."""
    clear_chunks(database, document_id)
    for position, (ordinal, text) in enumerate(chunks):
        cursor = database.execute(
            "INSERT INTO chunks(document_id, ordinal, text) VALUES(?,?,?)",
            (document_id, ordinal, text),
        )
        chunk_id = cursor.lastrowid
        database.execute("INSERT INTO chunk_fts(rowid, text) VALUES(?,?)", (chunk_id, text))
        if embeddings is not None:
            database.execute(
                "INSERT INTO chunk_vectors(chunk_id, embedding) VALUES(?,?)",
                (chunk_id, embeddings[position].astype(np.float32).tobytes()),
            )


def clear_chunks(database: sqlite3.Connection, document_id: int) -> None:
    """An external-content FTS5 table is told what it is losing: deleting the row is not enough."""
    existing = database.execute(
        "SELECT id, text FROM chunks WHERE document_id = ?", (document_id,)
    ).fetchall()
    for chunk_id, text in existing:
        database.execute(
            "INSERT INTO chunk_fts(chunk_fts, rowid, text) VALUES('delete', ?, ?)",
            (chunk_id, text),
        )
        database.execute("DELETE FROM chunk_vectors WHERE chunk_id = ?", (chunk_id,))
    database.execute("DELETE FROM chunks WHERE document_id = ?", (document_id,))


def forget_document(database: sqlite3.Connection, document_id: int) -> None:
    """A document that has left the corpus, or one a list now forbids."""
    clear_chunks(database, document_id)
    database.execute("DELETE FROM name_fts WHERE rowid = ?", (document_id,))
    database.execute("DELETE FROM documents WHERE id = ?", (document_id,))


def _words(path: str) -> str:
    """The path as terms: separators and punctuation are not what a person types."""
    return "".join(character if character.isalnum() else " " for character in path)
