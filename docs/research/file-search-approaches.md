# Natural-language file search on the mini

Research for [#8](https://github.com/Jerome-Group/syrax/issues/8). Question: what are the
workable approaches to semantic (not word-for-word) search over the mini's filesystem —
primarily `/Volumes/RAID0` — within 16 GB shared RAM, given that local chat models are ruled
out but small local embedding models are not, and remote embeddings face the free-token
constraint?

Researched 2026-08-15 against primary sources (official docs, pricing pages, the projects'
own repositories) plus measurements taken on the mini itself. Every load-bearing claim
carries a URL.

## Ground truth, measured on the mini

These numbers change the problem. The volume is large in bytes but small in documents:

| Measurement | Value | How obtained |
|---|---|---|
| Volume used | 607 GiB of 3.6 TiB | `df -h /Volumes/RAID0` |
| Total inodes used | ~65 k | `df` inode count |
| Text documents (`public.text`) | 652 | `mdfind -count`, Spotlight |
| PDFs and other composite documents | 2 089 | `mdfind -count`, Spotlight |
| Images / audiovisual | ~100 | `mdfind -count`, Spotlight |
| Spotlight indexing on the volume | **already enabled** | `mdutil -s /Volumes/RAID0` |
| Machine | Mac mini (M4, `Mac16,10`), 16 GiB unified memory | `sysctl` |

So the ~600 GiB is a small number of large files; the embeddable corpus is **roughly 3 000
documents** (plus whatever Spotlight cannot see, e.g. inside archives). At that scale every
approach below fits trivially in RAM, brute-force cosine search is milliseconds, and no
approximate-nearest-neighbour infrastructure is needed. The binding constraints are model
residency, privacy, and maintenance — not index size.

## A. Local embedding index

**RAM cost of small embedding models — confirmed low.** The 16 GB ceiling that rules out
local chat models does not bite here; text embedders are one to two orders of magnitude
smaller:

| Model | Size / RAM | Notes |
|---|---|---|
| model2vec `potion-multilingual-128M` (static) | tens of MB; no transformer inference | What [semtools](https://github.com/run-llama/semtools) ships; static lookup, extremely fast on CPU |
| `all-MiniLM-L6-v2` | 22.7 M params, ~80 MB file, 384-d | [Model card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) |
| `BAAI/bge-small-en-v1.5` | same weight class | Default embedder in [ck](https://github.com/BeaconBay/ck) |
| Google EmbeddingGemma (308 M) | **< 200 MB RAM quantised** (QAT), 2 K context | [Google announcement](https://developers.googleblog.com/en/introducing-embeddinggemma/), [model docs](https://ai.google.dev/gemma/docs/embeddinggemma); 622 MB pull via [Ollama](https://ollama.com/library/embeddinggemma) |
| `jina-embeddings-v5-omni` (multimodal) | ~1.9 GB (Nano) / ~3.1 GB (Small) | Used by [Omni](https://github.com/hanxiao/omni-macos); the heavy end |

The embedder only needs to be resident while indexing or answering a query; nothing holds
RAM between searches.

**Index arithmetic.** ~3 000 documents at, say, 10 chunks each is ~30 k vectors; at 384
dimensions in float32 that is ~46 MB — under 100 MB even at 768-d. Store it in
[sqlite-vec](https://github.com/asg017/sqlite-vec) (single-file, dependency-free SQLite
extension, brute-force KNN — explicitly aimed at local/embedded scale) or LanceDB (what
semtools and others embed). Text extraction for PDFs via `pdftotext` or macOS `textutil`.

**Verdict:** workable with large headroom; the reference approach.

## B. Spotlight / `mdfind` hybrid

Spotlight already maintains a full-text and metadata index of the volume **incrementally and
for free** (confirmed enabled, above). [`mdfind`](https://ss64.com/mac/mdfind.html) queries
it from the CLI (`-onlyin`, `-live` for standing queries, `kMDItemTextContent` for
full-text); on current macOS the index even includes OCR'd text from images
([Eclectic Light](https://eclecticlight.co/2025/08/13/how-to-search-spotlight-for-live-text-and-objects-in-images/)).
But it is keyword/metadata matching — no public API or CLI exposes a *semantic* (vector)
query over Apple's index.

The hybrid that works: use `mdfind` as a **zero-RAM candidate generator** (query-term
expansion → keyword search → candidate set), then embed and rerank only the candidates with
a small local model. This needs no corpus-wide vector index at all, but recall is bounded by
the keyword step — a document that shares no vocabulary with any expanded query term is
never found. Best used as one arm of a hybrid (keyword + vector, fused), not alone.

Apple's own on-device embedding API,
[`NLContextualEmbedding`](https://developer.apple.com/documentation/naturallanguage/nlcontextualembedding)
(NaturalLanguage framework, BERT-style, token vectors pooled to sentence vectors), is a
zero-download native alternative for the embedding step, at the cost of custom Swift glue.

**Verdict:** free, already running, and the right *first stage* — but not semantic by
itself.

## C. Existing open-source tools

| Tool | What it is | Fit |
|---|---|---|
| [semtools](https://github.com/run-llama/semtools) (run-llama, MIT, Rust) | CLI `search`/`workspace` are **fully local** (model2vec static embeddings, LanceDB); changed files are automatically re-embedded; `parse` needs LlamaParse cloud and `ask` needs an OpenAI key — both skippable | Strong: minimal RAM, trivial install (`cargo`/`npm`) |
| [ck](https://github.com/BeaconBay/ck) ("seek", Rust) | grep-compatible **hybrid BM25 + semantic** search, local bge-small embeddings, chunk-level incremental indexing, offline, **built-in MCP server** for agent integration | Strong: hybrid ranking and MCP fit Syrax's agent-first shape |
| [Omni](https://github.com/hanxiao/omni-macos) (Apache-2 code, CC-BY-NC weights) | Native macOS/MLX semantic search over text **and images/audio/video** in one vector space; incremental by mtime + content hash; macOS 14+, Apple silicon | Capable but heavy: 1.9–3.1 GB of the shared 16 GB while active; the fallback if multimodal search becomes a requirement |
| Hyperlink by [Nexa AI](https://www.producthunt.com/products/hyperlink-by-nexa-ai) | Closed-source on-device "chat with your files" app (16 GB Macs recommended, per its listings) | Poor fit: bundles local chat LLMs — the thing the constraint rules out — and is not scriptable |

**Verdict:** off-the-shelf options exist that are local, incremental, and within budget;
ck and semtools are the two worth trialling.

## D. Remote embeddings vs the free-token constraint

One-time indexing cost for ~3 000 documents is roughly 10 M tokens (order of magnitude), and
every later query costs a few hundred. Against current free tiers:

| Provider | Free allowance | Catch |
|---|---|---|
| Gemini `gemini-embedding-001` | Free tier, input free of charge ([pricing](https://ai.google.dev/gemini-api/docs/pricing)); per-account rate limits now shown only in AI Studio ([rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)) | **Unpaid-tier content is used by Google "to provide, improve, and develop" its products, with possible human review** ([API terms](https://ai.google.dev/gemini-api/terms)) — private files would leave the machine on those terms |
| Voyage AI | First 200 M tokens free per model for the voyage-4 family ([pricing](https://docs.voyageai.com/docs/pricing), [models](https://www.mongodb.com/docs/voyageai/models/)) | Covers this corpus ~20× over; still a cloud dependency per query |
| Jina | 10 M free tokens per new key; free keys 100 RPM / 100 K TPM ([embeddings](https://jina.ai/embeddings/)) | One-shot: the corpus alone roughly exhausts it |
| Cohere | Trial keys: 1 000 calls/month total, Embed capped at 5 calls/min ([rate limits](https://docs.cohere.com/docs/rate-limits)) | Too tight for indexing plus queries |
| Mistral | Free "Experiment" tier includes embeddings; exact limits per-account in the console ([tiers](https://docs.mistral.ai/deployment/laplateforme/tier)) | Evaluation-only positioning |

Beyond quotas: every search needs the network, re-indexing spends tokens forever, and the
file contents themselves become private runtime state held by a third party — on the free
tiers, sometimes on training-permitted terms. The quality edge of large remote embedders is
wasted on a 3 000-document corpus that a MiniLM-class model already separates well.

**Verdict:** technically feasible inside some free tiers (Voyage most comfortably), but
strictly dominated by local models at this scale on privacy, availability, and maintenance.

## Incremental re-indexing

- **Change detection at this scale is a non-problem**: a full `stat` scan of ~65 k inodes
  takes seconds, so "re-scan on demand" (what semtools and ck do when a workspace opens,
  comparing mtime/size or content hash — Omni does mtime + size + content hash) is enough.
- For push-style updates, macOS's native
  [FSEvents](https://developer.apple.com/documentation/coreservices/file_system_events) is
  the change feed Spotlight itself rides; [fswatch](https://github.com/emcrisostomo/fswatch)
  wraps it for scripts, and `mdfind -live` maintains standing queries. A `launchd` periodic
  job re-running the indexer is the simplest robust form; no resident daemon is required.
- Content-hash (not just mtime) comparison makes moves and copies cheap: the vector is
  reused, only the path row changes.

## Confidence-ranked shortlist

Raw cosine similarities are not calibrated probabilities, so a shortlist UX ("here are the
five files I think you mean — confirm") should be built from:

1. **Hybrid retrieval** — fuse keyword/BM25 (Spotlight or ck's BM25 arm) with vector scores
   (e.g. reciprocal-rank fusion); agreement between the two arms is itself a confidence
   signal. ck does this natively.
2. **Score-gap heuristics** — a large gap between candidate 1 and candidate 2 means "sure";
   a flat top-k means "ask the Owner".
3. **Optional local reranking** — a MiniLM-class cross-encoder such as
   [`ms-marco-MiniLM-L6-v2`](https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2)
   (same ~tens-of-MB weight class as the embedder) rescoring the top ~20 sharpens ordering
   and yields more usable relative scores, still fully local.

Present top-k with path, score band, and a matched snippet; confirm before acting.

## Recommendation

**Adopt a local embedding index with a small local model, fronted by hybrid
(keyword + vector) retrieval; do not use remote embeddings.**

Concretely, for the decision ticket:

1. **Trial [ck](https://github.com/BeaconBay/ck) first** — it already is the recommended
   shape: local bge-small embeddings, hybrid BM25 + semantic ranking, chunk-level
   incremental indexing, offline, MIT-family Rust install, and an MCP server that plugs
   straight into an agent runtime. **[semtools](https://github.com/run-llama/semtools)** is
   the equally-local, even lighter alternative (static embeddings) if ck disappoints; use
   only its local `search`/`workspace` commands.
2. **Keep Spotlight as the metadata/keyword arm and candidate pre-filter** — it is already
   indexing the volume incrementally at zero cost; `mdfind -onlyin /Volumes/RAID0` needs no
   new infrastructure.
3. **RAM budget: confirmed a non-issue** — the whole stack (embedder + index + reranker) is
   a few hundred MB, resident only while indexing or querying, against 16 GB shared.
4. **The index is private runtime state** — derived from private file contents, it lives
   outside this repository's checkout (e.g. under the private runtime root), like every
   other cache.
5. **Rejected:** remote embeddings (free tiers are either training-permitted — Google's
   unpaid tier explicitly so — or quota-tight, and every query would need the network);
   Omni (1.9–3.1 GB resident is affordable but unjustified unless image/audio/video search
   becomes a requirement — it is the named fallback for that case); Hyperlink (closed
   source, bundles the local chat models the constraint rules out).
6. **Escalation path if quality disappoints:** swap the embedder for EmbeddingGemma via
   Ollama (< 200 MB RAM quantised) before considering anything remote.
