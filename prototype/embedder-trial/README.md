# Prototype — embedder trial (issue #34)

**Throwaway.** This branch is a primary source, not code to build on. What survives is the
decision, recorded on [#34](https://github.com/Jerome-Group/syrax/issues/34) and in
[ADR-0004](../../docs/adr/0004-syrax-owns-the-file-search-index.md). Nothing here is merged
to `main`.

It answers one question: which embedding model does the file-search index use, and does any of
them reach Artin–Wedderburn from a description rather than the name?

## What it does

Builds [ADR-0004](../../docs/adr/0004-syrax-owns-the-file-search-index.md)'s shape — one SQLite
file, an FTS5 keyword arm and a `sqlite-vec` vector arm over the same extracted text, ~512-token
windows at ~15% overlap, collapsed to the best chunk per document — over one folder of the corpus,
then swaps the embedder and holds everything else constant.

| Script | What it answers |
| --- | --- |
| `extract.py` | Walks the folder under ADR-0004's rules, extracts and chunks. Chunks once, with one tokenizer, so the trial varies the model and nothing else. |
| `embed.py` | `bge \| gemma \| potion` — embeds those chunks, writing `index_<name>.sqlite`. |
| `evaluate.py` | Scores an index against the benchmark: recall, latency, and the raw numbers behind a `confident` / `ambiguous` / `empty` verdict. |
| `diagnose.py` | For a miss, is it the embedder or the ranking? Brute-force cosine over every chunk, reporting where the expected document's best chunk actually sits. |
| `variant.py` | Whether a length penalty or a wider candidate pool rescues the ranking. |

## Running it

Everything installs and stores under `/Volumes/RAID0`, per the effort's standing constraint.

```bash
cd "/Volumes/RAID0/104 Syrax/prototype-34-WIPE-ME"
python3.14 -m venv .venv && ./.venv/bin/pip install fastembed sqlite-vec model2vec
export HF_HOME="$PWD/hf-cache"
./.venv/bin/python extract.py
./.venv/bin/python embed.py potion && ./.venv/bin/python evaluate.py potion
```

The corpus, the indexes and the benchmark stay outside the checkout: they are derived verbatim
from private documents, and placement is what keeps them out rather than an ignore rule.

## Two things a reader should not copy

- The benchmark lives at `104 Syrax/benchmark/retrieval-eval.jsonl` and holds the Owner's real
  queries against real paths. It is private runtime state.
- `evaluate.py` adds a **name-match half to the keyword arm** that ADR-0004 does not describe.
  That is a finding, not a liberty — see #34.
