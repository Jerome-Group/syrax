"""How a string becomes words, on both sides of the keyword arm.

The write side indexes a document's path and the read side turns a query into terms. They have to
agree on what a word is: separators and punctuation are not what a person types, and if one side
starts splitting differently from the other, name matching stops working and nothing says so.
"""

from __future__ import annotations

# #34's list, carried over from the trial the floors were fitted against rather than written here:
# "and" and "for" survive a bare length filter and appear in every chunk, which is how
# "Dummit and Foote" ranked a poster's bibliography above the book itself.
COMMON = (
    "the and for was what that with from this you your are how does did where which about into "
    "out who why when they them its has have had can could would should will shall may might "
    "must one two not but all any our his her their"
)
STOP_WORDS = frozenset(COMMON.split())


def words_of(text: str) -> list[str]:
    """Every alphanumeric run, lowercased. What the name arm is built from."""
    return "".join(one if one.isalnum() else " " for one in text).lower().split()


def terms_of(query: str) -> list[str]:
    """The words worth matching on: the short ones and the ones every document holds are dropped."""
    return [word for word in words_of(query) if len(word) > 2 and word not in STOP_WORDS]
