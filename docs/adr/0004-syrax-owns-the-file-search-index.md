# Syrax owns the file-search index

> **Amended by [ADR-0023](0023-the-verdict-floors-are-read-against-the-distance-the-trial-measured.md)**
> in one part — the quantity the two floors below are read against is `1 - distance` under
> `sqlite-vec`'s default metric, which is L2 and not the cosine this record calls it. The numbers
> stand; the word is marked where it appears.

Natural-language file search is built here: one SQLite database carrying a keyword arm and a vector
arm over the same extracted text, indexed by a small Python process and served to the runtime as a
long-lived MCP server. [ck](https://github.com/BeaconBay/ck) and
[semtools](https://github.com/run-llama/semtools) — the two candidates
[`docs/research/file-search-approaches.md`](../research/file-search-approaches.md) recommended
trialling — are rejected, as is Spotlight.

This is the one place Syrax builds a capability rather than reaching for a product's own tools. It
earns the exception because no capability product owns file search: [#12](https://github.com/Jerome-Group/syrax/issues/12)
made broad search something Syrax itself requires.

## What decided it

Not a feature comparison, but the requirements that were already fixed before the tools were
looked at. [#10](https://github.com/Jerome-Group/syrax/issues/10) required one index, path-scoped at
query time. [#12](https://github.com/Jerome-Group/syrax/issues/12) required exclusion enforced at
index time, an indexer that does not follow symlinks, exactly one retrieval tool, and a confidence
signal strong enough to separate "act on this" from "ask which one".

`ck` meets the ranking requirement and fails the rest. Its index is per-root — a `.ck/` directory
per tree, with `CK_INDEX_DIR` re-homing them hashed rather than merging them — so ten roots means
ten indexes. It indexes text and code files and does not extract PDFs, which is two thirds of the
corpus. Its MCP server exposes six tools where one was decided. Its symlink behaviour is documented
nowhere, and symlinks are not a detail here: `~/Google Drive` points at the same tree as
`/Volumes/RAID0/My Drive`, so a following walk turns a folder of seventeen files into 56,134.

`semtools` fails further: no exclude patterns, no documented multi-root workspace, and PDF handling
only through LlamaParse's cloud — the remote path already rejected on privacy grounds.

Spotlight was measured on this machine reaching **one root in ten**: content search returns 2,605
hits under `My Drive` and zero across the rest of the volume, because `My Drive` is indexed by
Google Drive's file provider rather than by the volume's own store. Keeping it as the keyword arm
for one root and building FTS5 for the other nine would mean two keyword arms with incomparable
scores — and the score comparison is the confidence signal the whole shortlist UX rests on.

So each requirement, under `ck`, would have been met by something wrapped around it: an extraction
stage in front, a merge layer across ten indexes, an MCP front narrowing six tools to one.
[ADR-0003](0003-the-runtime-adapter-wraps-openclaw.md) argued that a wrapper written to make a
dependency swappable becomes the thing that has to be rewritten. Owning the index makes each
requirement a line to point at instead: path scoping is a `WHERE` clause, one index is one file,
symlink policy is our own directory walk.

## Measured on the mini

The decision rests on numbers taken here rather than estimated, and they correct the research in
two places.

| | |
| --- | --- |
| `My Drive` | 3,097 files, 2,139 PDF |
| `100 GRENADE` | 1,733 files, 1,559 PDF (90%) |
| `100 GRENADE/001 Projects/pyps` | 1,546 PDFs, 11 GB — nearly all of that root's PDFs |
| `~/Documents/Zotero` | 748 files but **3 PDFs**; the rest is `translators/`, `locate/` and `zotero.sqlite` |
| `~/Downloads` | empty (counted 17 a day earlier) |
| `~/org` | no longer exists (counted 17 a day earlier) |
| PDF extraction | **0.06 s/file** — about 3 minutes for all 3,694 in scope. #34 measured **0.284 s/PDF** on a textbook-heavy folder, so this rate is a property of the documents rather than of the machine, and the estimate holds only where the corpus is short PDFs |
| PDFs with no usable text layer | ~5%, roughly 185 corpus-wide |
| Extracted text | ~117 M characters ≈ 29 M tokens ≈ ~67,000 chunks |
| Resulting index | ~103 MB of vectors, ~300 MB SQLite file |

Zotero's root is therefore `Zotero/storage` rather than the profile directory — the same trim #12
made one level up, without which 745 files of application state enter the corpus. `~/Downloads` and
`~/org` stay on the allowlist and contribute nothing today.

The extraction figure is what settles the refresh cadence below: re-reading every PDF costs three
minutes, so the expensive step is embedding rather than extraction, and the two can be scheduled
independently.

## The shape

**One SQLite file, two arms.** FTS5 carries the keyword arm and
[`sqlite-vec`](https://github.com/asg017/sqlite-vec) the vector arm over the *same* extracted text.
Rank fusion is then a join rather than a reconciliation across stores, and scoped search is a
`WHERE` clause on the path — which is what #10 meant by "the same retrieval with a restriction,
not a second system".

**The keyword arm indexes the document's name as well as its text**, which "the same extracted
text" above silently excluded. [#34](https://github.com/Jerome-Group/syrax/issues/34) found the
omission the way it would have been found in use: *Dummit and Foote* returned a poster's
bibliography, because the book's own filename —
`Abstract Algebra 3e Dummit, Foote.pdf` — was in no index at all. Adding a name match moved
recall@1 from 4/14 to 5/14 and the reciprocal rank from 0.378 to 0.486. This is not the same as
the filename-only indexing the extraction scope describes below: that is what a document gets
*instead* of its contents, and this is what every document gets *as well as* them.

**Fixed overlapping windows, ~512 tokens at ~15% overlap**, scored per chunk and collapsed to the
best chunk per document. One vector per document fails the stated bar outright: the query this
system must answer is a phrase inside a long PDF, and a forty-page document averaged into a single
vector never surfaces it. Structural chunking would need a parser per format across a corpus that
is Drive exports, textbooks and Markdown at once.

**Python 3.14 with `fastembed`/`onnxruntime`.** `pdftotext`, `pandoc` and `tesseract` are already
installed and are subprocess calls from any language, so the choice turns on the embedding and
vector stack, where Python's pieces all have working wheels today and an embedder can be swapped in
one line while the model is still being trialled. One consequence is load-bearing: **the search
tool runs as a long-lived MCP server, never a per-query script.** Query latency at 67,000 chunks is
dominated by interpreter and model load, not by the vector scan, so a resident *process* is what
makes the language choice free. The long-lived process is the load-bearing part; whether the model
itself stays in memory the whole time is settled separately below, and it does not.

**Two tools, and this amends #12.** `search` ranks a corpus; `read` returns the text of a named
file. #12 decided General carries *exactly one retrieval tool*, and that rule is restated as
exactly one **retrieval** tool. What it forbade was the model choosing between capabilities — an
intent router with a recovery path for choosing wrong. Two tools with disjoint, obvious purposes is
not that choice, and folding them into one tool with a mode parameter would make a single contract
branch internally while presenting itself as simple.

**The tool returns a verdict, not raw results.** Thresholds live in the tool rather than in the
model's prompt, so they are numbers in one place that can be tuned against real queries instead of
prose a model may quietly reinterpret. Three states, and `confident` is deliberately hard to reach:
it requires the top result to clear an absolute score floor, **and** to beat the runner-up by a
margin, **and** for both arms to rank it first independently. That third condition is what makes
the bar real — a phrase only the vector arm likes is precisely where semantic search invents a
plausible wrong file, and that is the failure that costs trust, because it sends the wrong document
without asking. Anything short of all three is `ambiguous` and renders as three candidates;
nothing above the floor is `empty`, stated plainly.

**The three conditions did not survive the trial, and two of them are withdrawn.**
[#34](https://github.com/Jerome-Group/syrax/issues/34) tuned them against real queries and found
each one measuring something other than what it was asked to:

- **The absolute floor cannot separate a right answer from a wrong one.** The two distributions
  overlap almost entirely — for the pinned model, correct answers score −0.172 to 0.157 and wrong
  ones 0.002 to 0.118 — so any floor high enough to reject a wrong answer rejects correct ones
  first. `Dummit and Foote` is *right* at ~~a cosine~~ a score of −0.17, because it wins on the
  keyword arm entirely. A floor on ~~cosine~~ that score would return `empty` for every query that
  names its target. *(The metric is L2 rather than cosine —
  [ADR-0023](0023-the-verdict-floors-are-read-against-the-distance-the-trial-measured.md).)*
- **The margin separates nothing.** Correct answers were found at a gap of 0.00000 and wrong ones
  at 0.00239.
- **Both arms agreeing** was a perfect precision filter for the two rejected models and **fires
  falsely for the pinned one**, which is the only place it matters.

So the floor keeps only its *other* job — triggering `empty` — where it works cleanly: **−0.23**,
in a window from −0.292 to −0.172 that separates an unanswerable query from every correct answer.
`confident` becomes a single condition, a floor of **0.12** on the fused top result, which marks 4
of 14 queries confident with none wrong.

That 0.12 is **provisional and fitted**, and is recorded as such rather than presented as tuned: it
sits 0.003 above a wrong answer on a fifteen-query benchmark, which is a number chosen by the
benchmark's smallest gap rather than by evidence. It is safe in the direction that matters — being
too cautious costs a shortlist, where being too eager sends the wrong file — and it is the first
thing [#35](https://github.com/Jerome-Group/syrax/issues/35) should revisit once the benchmark has
grown.

**Scope is bound per chat in configuration, never passed by the model.** The academic chat's agent
gets the tool pre-bound to the modules root; General's reaches the whole allowlist. Were scope a
model-supplied argument, the capability boundary would be model-settable and a chat could widen its
own reach in one confused turn. #12 put exclusion at index time "never at query time" for the same
reason; this is that argument one level up.

## Three lists, not one

The part most likely to be got wrong later. "The allowlist" was doing four jobs, and they are
different:

- **The index allowlist** — the ten roots that are crawled and indexed. It is a **compute scope,
  not a boundary**: it is sized by what is worth indexing on this machine, and on a faster one it
  would be everything.
- **The extraction scope** — which of those roots get their PDFs read. At v1, `My Drive` and
  `100 GRENADE/001 Projects/pyps`. It is **additive**: a path is added on request, and because the
  pipeline is root-agnostic, adding one is configuration rather than a build. PDFs inside the
  allowlist but outside this scope are indexed by filename and path only, so a search can say
  "this exists, I cannot read inside it" rather than returning silence.
- **The blocklist** — never indexed, never extracted, never readable, anywhere on the machine.
  Secrets and keys, credential and session stores, `~/Library`, session transcripts, the
  percent-encoded Chrome profile, Time Machine's sparsebundle, media-library internals, build and
  vendor trees, any dotfile, and **Syrax's own private runtime root** — without that last entry the
  index would index itself and the chat archive.
- **Ephemeral extraction** — a `read` of a file outside the index, held in the resident server's
  memory keyed by path, evicted on a ~30-minute idle TTL and on restart. It never touches disk.
  That delivers automatic purging without an agent judging when deletion is safe, which would be an
  agent doing more than it is configured for; and it is strictly safer, because there is no file to
  leak and a crash purges by construction.

### The blocklist fails open, and that is a choice

#12 chose an allowlist over a denylist explicitly, because "a denylist on a personal machine fails
open — a new private tree appears and is silently searchable". That reasoning still governs
*search*, which the index allowlist still bounds.

It no longer governs *reading*. The `read` tool reaches outside the allowlist, bounded by the
blocklist alone, on the Owner's position that the allowlist exists for compute rather than for
safety — that a faster machine would index everything, so the roots are a budget and not a fence.

The consequence, stated so it is not discovered later: **a new private tree becomes readable on
demand the moment it exists, unless a blocklist pattern already covers it.** The blocklist is
therefore a living list, revisited when the machine changes, and not one set once. That is the
price of the choice, and it is worth naming next to the choice rather than in a postmortem.

## Freshness

- **Hourly incremental**, comparing `(path, size, mtime)` and re-extracting only mismatches.
  Content hashing on this pass would mean reading ~14 GB every hour to buy correctness that only
  shows up after a mass move.
- **A full pass every 3 days**, re-extracting everything unconditionally — which is what catches a
  file that broke silently — while keying embedding on the hash of the *extracted text*, so the
  expensive step still runs only on genuinely new content. A file that was corrupt last week and is
  fine today is picked up even though its mtime never moved. Three days rather than nightly leaves
  compute headroom for a heavier embedder after the trial.
- **OCR** runs once over the ~185 PDFs with no text layer, via `tesseract`, cached, and retried
  from the failure ledger. A scanned handout that returns nothing is the silent empty #12 ruled
  out.
- **A failure ledger** records every extraction failure; the 3-day pass retries it and the System
  chat can report it.

## The embedder, pinned by measurement

Left open above and settled by the trial on [#34](https://github.com/Jerome-Group/syrax/issues/34),
against the Owner's own queries over one folder of the corpus — 204 documents, 14,577 chunks, the
same chunks for every model so what varied was the model and nothing else.

| | potion-multilingual-128M | bge-small-en-v1.5 | EmbeddingGemma-300M `q4` |
| --- | --- | --- | --- |
| Recall@1 | 5/14 | 6/14 | **10/14** |
| Reaches Artin–Wedderburn from a description | rank 1 | **rank 4 — fails** | **rank 1** |
| Resident | 1,153 MB | 269 MB | **698 MB** |
| Cold build, full corpus | ~15 s | ~77 min | ~3 h |
| Query | 15 ms | 59 ms | 38 ms |

**`EmbeddingGemma-300M` is the embedder**, in the `model_q4` ONNX export.

The trial's own ranking — speed slightly ahead of compute, accuracy close behind — would have
chosen `potion`, and it is the one candidate that fails on both of its own axes: it is 4.3× the
resident size of `bge` *and* less accurate, because a static model buys its 4,714 chunks/s by
holding a multilingual vocabulary in memory instead of doing inference. Speed turned out not to
discriminate: the build is paid once in the background, and every candidate answers a query inside
60 ms.

`bge-small-en-v1.5` is the light one and is rejected on the bar rather than the budget. It puts
`Odyssey_Project.pdf` — the compiled book that *contains* the Wedderburn chapter — above the chapter
itself, and widening the candidate pool from 40 to 600 does not move it, so this is the model's
judgement rather than the ranking's. That bar is [#10](https://github.com/Jerome-Group/syrax/issues/10)'s
and it is the reason a vector arm exists at all.

**The quantisation is load-bearing, and the obvious choice is the wrong one.** The int8
`model_quantized` export is the heaviest and the slowest of the five the repository ships — 1,376 MB
resident at 4.0 chunks/s — because int8 weights are dequantised to fp32 to compute. `model_q4` holds
698 MB at 6.2 chunks/s for **identical recall@1**, halving both the memory and the build. Disabling
onnxruntime's arena makes it worse, not better (1,904 MB), so the resident size is the model's
rather than a tuning default.

## The embedder is evicted after an idle window

This ADR originally required the model resident continuously, having weighed that only against a
per-query script. There is a third option it did not consider, and it is the one taken: **hold the
model while search is being used and evict it after 30 minutes idle.**

Search is bursty. Continuous residency spends 698 MB for twenty-four hours to save a few seconds on
the handful of occasions a day the tool is actually reached, which is the wrong side of that trade
on a 16 GB machine already carrying the gateway and a media stack. The idle window is 30 minutes to
match the TTL ephemeral extraction already uses below, so the search service has one idea of "recently
used" rather than two.

The cost is stated plainly rather than minimised: **the first search after a gap pays the model
load — 2.27 s**, measured, against 9 ms for a query on a warm model. On a bursty pattern that is a
large share of searches, so the window is the knob that decides how often it is paid.

Deliberately **not** gated on a footprint measurement. [ADR-0005](0005-launchd-supervises-syrax-as-two-launchagents.md)
defers footprint decisions to a 7-day steady-state observation, and that observation is not worth
blocking this on: eviction is cheap to build, reversible in configuration, and waiting for a number
before spending it would hold up the thing the number is meant to inform.

## Consequences

- The index lives outside the checkout, under the private runtime root on the external volume,
  alongside the runtime's own state directory rather than inside it — a runtime re-pin or state
  reset must not take hours of embedding with it. `.gitignore` is not the control: it stops an
  accidental `git add` and nothing else, and this repository states its rule as placement.
- `config/syrax.example.toml` carries `search_index` and `benchmark` as placeholder paths beside
  the existing private roots, and `docs/configuration.md` carries the rebuild and reset procedure.
- The glossary gains four terms, because one word was carrying four meanings.
- Adding a root to the extraction scope is a configuration change, not a build.

## Revisit when

- The pinned model's recall stops being good enough in use. The trial measured 10 of 14 on a
  fifteen-query benchmark, which is enough to choose between three candidates and not enough to
  call the retrieval solved — the four it missed were all descriptions of a concept, answered with
  a textbook that covers it rather than the chapter about it. Growing the benchmark is
  [#35](https://github.com/Jerome-Group/syrax/issues/35), and it is what would make this
  measurable rather than felt.
- The `confident` floor of 0.12 is revisited on a benchmark larger than fifteen queries, because it
  was fitted to that one.
- The corpus grows by an order of magnitude, at which point brute-force cosine over one SQLite file
  stops being the obvious answer.
- Image, audio or video search becomes a requirement — the research names Omni as the fallback, at
  1.9–3.1 GB resident.
- The machine changes shape, which is a prompt to re-read the blocklist rather than to trust it.
