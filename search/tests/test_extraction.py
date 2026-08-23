"""What counts as a document's own text, and what only looks like it."""

from __future__ import annotations

from syrax_search.extraction import has_text_layer

# What `pdftotext` returns for a scanned paper stamped by the library, once per page.
STAMP = (
    "ATTENTION: The Singapore Copyright Act applies to the use of this document. "
    "Nanyang Technological University Library"
)


def test_a_stamp_repeated_per_page_is_not_a_text_layer():
    """952 characters of it clears every length test, and the paper is then filed as read."""
    scanned = "\n\n\x0c".join([STAMP] * 16)
    assert len(scanned) > 900, "long enough to pass every length test there is"
    assert has_text_layer(scanned) is False


def test_a_short_document_is_still_a_document():
    assert has_text_layer("Meeting notes: we agreed to postpone the migration until the audit.")


def test_a_stamped_document_that_also_has_text_is_a_text_layer():
    """The stamp is on every page of a readable paper too — it must not condemn one."""
    page = f"{STAMP}\n\nQuestion 1. Let f be continuous on [0,1]. Show that f attains its bound."
    assert has_text_layer("\n\x0c".join([page, page, page]))


def test_nothing_is_not_a_text_layer():
    assert has_text_layer("") is False
    assert has_text_layer("  \n\x0c \n ") is False


def test_the_rule_needs_a_few_pages_to_see_the_repetition():
    """Stated rather than hidden: two stamped pages are half distinct, and are not caught.

    The share only falls once the stamp has been repeated a handful of times. A two-page scan
    therefore still enters the index on its stamp. The papers this exists for run to ten pages and
    beyond, so the limit is worth naming rather than worth chasing with a second rule.
    """
    assert has_text_layer("\n\x0c".join([STAMP] * 2)) is True
    assert has_text_layer("\n\x0c".join([STAMP] * 8)) is False
