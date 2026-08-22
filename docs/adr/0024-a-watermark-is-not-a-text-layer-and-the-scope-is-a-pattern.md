# A watermark is not a text layer, and the extraction scope is a pattern

Three changes with one cause: the first real corpus build, which found what a fixture corpus
structurally cannot. [ADR-0004](0004-syrax-owns-the-file-search-index.md) is the record they amend.

- **A text layer whose content is one line repeated is no text layer.** It goes to the failure
  ledger and to OCR, rather than into the index as content.
- **An extraction scope entry may be a glob as well as a root.** The scope says which *documents*
  are read, not only which trees they sit in.
- **The OCR page cap stays at 40, and this is where that is argued** rather than left as a constant.

## The defect: 1,199 documents claimed to have been read

`pdftotext` over a scanned exam paper stamped by the university library returns this, once per
page, and nothing else:

> ATTENTION: The Singapore Copyright Act applies to the use of this document. Nanyang
> Technological University Library

That is 952 characters across sixteen pages. The extractor's only test was length — 32 characters —
so the document was recorded `ok`, its stamp was indexed as its contents, and **it never reached
OCR, because it never looked empty.** Measured across the finished index: **1,199 documents**, of
which the overwhelming majority are the past-year papers under `pyps`.

This is the silent empty [#12](https://github.com/Jerome-Group/syrax/issues/12) ruled out, arriving
through a door nobody was watching. #12 asked what happens when a scanned handout returns *nothing*;
ADR-0004 answered it with OCR and a ledger. Neither asked what happens when it returns *something
worthless*, and that turned out to be the common case — the failure is worse than the one guarded
against, because the ledger reports nothing wrong and search asserts the document is about
copyright law.

**What gives it away is repetition, not length**, and the rule is a share rather than a count. A
count condemns the short documents that are real: a one-paragraph note is entirely distinct, and a
page of exam questions under the same stamp is a third distinct. The stamped scans measured here sit
between 0.06 and 0.12, so the line is drawn at **0.15**.

The rule needs a few pages to see the repetition, and a two-page stamped scan therefore still
enters the index on its stamp. That limit is stated rather than chased with a second rule: the
papers this exists for run to ten pages and beyond.

## The scope had to say *which documents*, not *which trees*

`pyps` is 1,546 papers across every faculty in the university. What is wanted from it is the 127 MH
ones — the Owner's own modules. As a list of roots the extraction scope cannot say that, so the
choice was all 1,546 or none.

**A fourth list was the obvious move and is refused.** ADR-0004's *"Three lists, not one"* is the
part of that record most likely to be got wrong later, and answering a new requirement by adding a
fourth would make the section it warns with false. The requirement is not a new *kind* of
restriction; it is the same restriction stated more precisely. So an entry becomes a root **or** a
glob, and the concept is unchanged: *the subset whose documents are opened and read*.

The consequence for the rest of `pyps` is the right one anyway. Those 1,419 papers become
name-only — findable by name, honest about not having been read — which is what they have actually
been all along while claiming otherwise.

`fnmatch` semantics, stated because they are not the shell's: `*` matches separators too, so
`…/pyps/*/MH*.pdf` reaches every depth beneath that root rather than exactly one.

## The page cap, argued rather than assumed

`OCR_PAGE_LIMIT = 40` was chosen when the no-text-layer set was assumed to be scanned handouts.
It is kept, and the reasoning is now recorded rather than implied:

- OCR is the only unbounded cost in the pipeline — **75.6 s per document measured** on this corpus,
  against fractions of a second for everything else. A cap is what makes an unattended pass a
  schedule rather than a hope.
- An exam paper runs to ten or twenty pages, so 40 truncates none of them. The 127 MH papers cost
  **about two hours** at this cap, which fits the three-day pass.
- A scanned 900-page textbook *is* truncated to its first 40 pages, and that is accepted: it stays
  findable, and reading all of it would be hours for one document.

Lowering it to 10 was live and is rejected. It would have saved ninety minutes on a pass that runs
every third day, at the cost of silently losing the back half of any paper longer than ten pages —
paying in correctness for a resource that is not scarce.

## Consequences

- **A scope change needs a reset**, which ADR-0004 already prescribes for exactly this. An
  incremental pass compares `(path, size, mtime)`, and none of those moves when the list does, so
  the documents whose membership changed would keep their stale rows. This is a cost — a full
  re-embed — and it is the price of not inventing a schema migration for a database that is
  derived state.
- The ledger grows by roughly 1,200 entries on the first pass after this, and that is the fix
  working: they were always unreadable and are now recorded as such.
- `CONTEXT.md`'s **extraction scope** entry says pattern rather than root, and ADR-0004's
  consequence line about adding a root is marked in place.

## Revisit when

- A two-page stamped scan turns out to be common, which is the limit the share rule accepts.
- Another root wants a pattern and the pattern grows a second wildcard form — at which point the
  question is whether `fnmatch` is still the right vocabulary, rather than whether the scope should
  be a list of lists.
