"""Turning one document into text, and recording it when that fails.

Extraction is subprocess calls to tools the machine already has — `pdftotext`, `tesseract`,
`pdftoppm` — because a document format is somebody else's problem and there are three of them here.
What is this module's problem is that a document which yields nothing must say so: a scanned
handout returning silence is indistinguishable from a document that does not exist, which is the
failure ADR-0004 ruled out by giving OCR a pass of its own and a ledger behind it.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
from dataclasses import dataclass

TEXT_SUFFIXES = frozenset(
    {".md", ".txt", ".tex", ".bib", ".csv", ".json", ".jsonl", ".yaml", ".yml", ".rst", ".org"}
)
PDF_SUFFIX = ".pdf"

# Drive exports are a large share of this corpus, and `pandoc` is already on the machine — without
# it a `.docx` inside the extraction scope silently degrades to being findable by name.
PANDOC_SUFFIXES = frozenset({".docx", ".odt", ".rtf", ".epub", ".html", ".htm", ".pptx"})

EXTRACTION_TIMEOUT_SECONDS = 180
OCR_TIMEOUT_SECONDS = 900

# A text layer this short is a page of ligature noise rather than a document.
USABLE_CHARACTERS = 32

# OCR is the only unbounded cost in the pipeline — a 500-page scan is minutes per document — and
# what a search needs from a scanned handout is enough text to find it by.
OCR_PAGE_LIMIT = 40


@dataclass(frozen=True)
class Extraction:
    text: str | None
    status: str

    @property
    def failed(self) -> bool:
        return self.status not in ("ok", "filename-only")


def extract(path: str, *, ocr: bool = False) -> Extraction:
    """The text of one document, or the reason there is none to index."""
    suffix = os.path.splitext(path)[1].lower()
    if suffix == PDF_SUFFIX:
        return _extract_pdf(path, ocr=ocr)
    if suffix in TEXT_SUFFIXES:
        return _extract_text_file(path)
    if suffix in PANDOC_SUFFIXES:
        return _extract_with_pandoc(path)
    return Extraction(None, "filename-only")


def _extract_with_pandoc(path: str) -> Extraction:
    completed = _run(
        ["pandoc", "--quiet", "-t", "plain", "-o", "-", path], EXTRACTION_TIMEOUT_SECONDS
    )
    if isinstance(completed, str):
        return Extraction(None, completed)
    text = completed.stdout.decode("utf-8", "replace")
    if len(text.strip()) < USABLE_CHARACTERS:
        return Extraction(None, "empty")
    return Extraction(text, "ok")


def _extract_text_file(path: str) -> Extraction:
    try:
        with open(path, "rb") as handle:
            text = handle.read().decode("utf-8", "replace")
    except OSError as error:
        return Extraction(None, f"error:{type(error).__name__}")
    if len(text.strip()) < USABLE_CHARACTERS:
        return Extraction(None, "empty")
    return Extraction(text, "ok")


def _extract_pdf(path: str, *, ocr: bool) -> Extraction:
    completed = _run(["pdftotext", "-q", "-enc", "UTF-8", path, "-"], EXTRACTION_TIMEOUT_SECONDS)
    if isinstance(completed, str):
        return Extraction(None, completed)
    text = completed.stdout.decode("utf-8", "replace")
    if len(text.strip()) >= USABLE_CHARACTERS:
        return Extraction(text, "ok")
    if not ocr:
        return Extraction(None, "no-text-layer")
    return _ocr_pdf(path)


def _ocr_pdf(path: str) -> Extraction:
    with tempfile.TemporaryDirectory() as workspace:
        pages = os.path.join(workspace, "page")
        rendered = _run(
            ["pdftoppm", "-r", "150", "-png", "-l", str(OCR_PAGE_LIMIT), path, pages],
            OCR_TIMEOUT_SECONDS,
        )
        if isinstance(rendered, str):
            return Extraction(None, rendered)
        recognised = []
        for image in sorted(os.listdir(workspace)):
            if not image.endswith(".png"):
                continue
            page = _run(
                ["tesseract", os.path.join(workspace, image), "stdout", "--psm", "1"],
                OCR_TIMEOUT_SECONDS,
            )
            if isinstance(page, str):
                return Extraction(None, page)
            recognised.append(page.stdout.decode("utf-8", "replace"))
    text = "\n".join(recognised)
    if len(text.strip()) < USABLE_CHARACTERS:
        return Extraction(None, "ocr-empty")
    return Extraction(text, "ok")


def _run(command: list[str], timeout: int) -> subprocess.CompletedProcess | str:
    """The completed process, or the ledger status that says why there is not one."""
    try:
        return subprocess.run(command, capture_output=True, timeout=timeout, check=False)
    except FileNotFoundError:
        return f"error:missing-{command[0]}"
    except subprocess.TimeoutExpired:
        return f"error:timeout-{command[0]}"
    except OSError as error:
        return f"error:{type(error).__name__}"
