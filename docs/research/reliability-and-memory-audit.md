# Reliability and memory audit

Research for [#290](https://github.com/Jerome-Group/syrax/issues/290), conducted
2026-09-26. The question was which observable defects and avoidable memory costs could be
corrected without changing the deployment's ownership boundaries or rebuilding its search index.

The work used isolated checkouts, synthetic documents, local provider and Telegram stubs, and
the public pinned embedding export. It did not deploy services or inspect private conversations
or the private corpus. The findings below describe tested paths, not a claim that every possible
defect has been eliminated.

## Observed defects and implemented corrections

| Area | Observed problem and resulting behavior | Change |
| --- | --- | --- |
| Private state | Truncating a state file exposed partial writes. Same-directory atomic replacement preserves the previous file on failure and private permissions. | [#264](https://github.com/Jerome-Group/syrax/pull/264) |
| Indexing | Entire document windows and vectors were retained together. Batches of 32 are inserted within one document transaction; inference failure rolls back replacement. | [#260](https://github.com/Jerome-Group/syrax/pull/260) |
| Scoped search | Global nearest-vector selection could starve an eligible scope; SQL wildcard interpretation could broaden a literal prefix. Eligibility now precedes nearest selection and prefixes remain literal. | [#262](https://github.com/Jerome-Group/syrax/pull/262) |
| Extraction | Successful OCR was counted as failure, while failed commands' stdout could be accepted. Accounting and subprocess success checks now match their outcomes. | [#263](https://github.com/Jerome-Group/syrax/pull/263) |
| Embedding | Initialization, inference and idle eviction could overlap. Shared model access is serialized; idle eviction skips a busy model. | [#265](https://github.com/Jerome-Group/syrax/pull/265) |
| Reader cache | Repeated reads could retain growing text and serve edited files indefinitely. A 16 MiB/128-entry LRU revalidates file identity and timestamps. | [#270](https://github.com/Jerome-Group/syrax/pull/270) |
| Document policy | Filesystem aliases and exclusions were compared in different forms. Canonical locations now share the same exclusion predicate. | [#275](https://github.com/Jerome-Group/syrax/pull/275) |
| Scheduled indexing | A launchd calendar dictionary encoded an array where an integer day was required. Separate interval dictionaries pass native plist validation. | [#266](https://github.com/Jerome-Group/syrax/pull/266) |
| Configuration landing | Time spent in gateway calls escaped the polling budget. Monotonic elapsed time now includes those calls. | [#274](https://github.com/Jerome-Group/syrax/pull/274) |
| Resident monitor | The fallback reader buffered and split the whole unread log, and mixed pathname metadata with an open descriptor. It reads fixed buffers and derives cursor data from one descriptor. | [#257](https://github.com/Jerome-Group/syrax/pull/257) |
| Calendar proposals | Concurrent proposals shared one temporary input. Each call now owns a private input and removes it after completion or refusal. | [#261](https://github.com/Jerome-Group/syrax/pull/261) |
| Academic recurrence | Daily intervals and weekly starts could shift dates; unsupported exceptions could silently lose meaning. Expansion preserves supported recurrence semantics and refuses unsupported forms. | [#271](https://github.com/Jerome-Group/syrax/pull/271) |
| Announcement dates | Reading a 4 KiB header loaded the entire document first. The file read itself is now bounded to 4 KiB. | [#278](https://github.com/Jerome-Group/syrax/pull/278) |
| Chat carriers | Independent processes could recreate duplicate topics and overwrite mappings. A kernel lock protects fresh-map reconciliation and regeneration; stalled Bot API calls have a timeout. | [#277](https://github.com/Jerome-Group/syrax/pull/277) |
| Extraction prefetch | Up to 64 completed document texts waited for consumption. An explicit queue retains at most eight extraction jobs/results in crawl order. | [#280](https://github.com/Jerome-Group/syrax/pull/280) |
| Index scheduling | Two requests in one event-loop turn could both accept an index pass before its worker acquired the lock. The pass is reserved before acceptance. | [#284](https://github.com/Jerome-Group/syrax/pull/284) |
| Document reads | Synchronous extraction blocked the event loop. Worker reads preserve SQLite/cache serialization through success, failure and repeated request cancellation. | [#289](https://github.com/Jerome-Group/syrax/pull/289) |
| Quota counters | A late prior-day reply could roll counters backward or refund a new day's spend. Day movement is monotonic, refunds retain their day, and malformed stored days use the documented fresh-ledger fallback. | [#286](https://github.com/Jerome-Group/syrax/pull/286) |
| Provider replies | Unexpected JSON shapes could throw after spending a request and prevent a refund. Normalization preserves status-based accounting and accepts only string content/error messages. | [#287](https://github.com/Jerome-Group/syrax/pull/287) |
| Monitor protocol | Parsing retained an unbounded request body and assumed valid envelopes. Retained input is capped at 1 MiB; envelopes and tool arguments are checked and interrupted reads settle. | [#288](https://github.com/Jerome-Group/syrax/pull/288) |
| Safe restart | A successful command acknowledged scheduling before reconnection. Landing now requires a fresh connected channel lifecycle within an elapsed deadline and makes no session-loss claim. | [#293](https://github.com/Jerome-Group/syrax/pull/293) |

## Memory measurements and their limits

These are representative isolated synthetic probes from the linked changes. They use different
metrics; their reductions cannot be added together or treated as deployment-wide RAM savings.
The elapsed times are individual observations, not a latency guarantee.

| Workload | Metric | Before | After | Interpretation |
| --- | --- | --- | --- | --- |
| 10,000 windows, 768 float32 dimensions | Peak traced Python buffering | 72.53 MiB | 0.23 MiB | 99.7% lower; both paths emit 30,720,000 vector bytes. Excludes input text, tokenizer IDs and native inference allocations. [#260](https://github.com/Jerome-Group/syrax/pull/260) |
| 64 completed extractions, 1 MiB text each | Retained / peak traced Python allocation at first consumption | 64.02 / 65.02 MiB | 8.02 / 9.02 MiB | Measures waiting extraction payloads; individual document size and model memory remain separate. [#280](https://github.com/Jerome-Group/syrax/pull/280) |
| 500 documents, 100,000 characters each | Retained traced Python allocation | 47.75 MiB | 12.25 MiB | The cache retains 128 entries. Its 16 MiB budget covers strings; the entry cap bounds additional bookkeeping. [#270](https://github.com/Jerome-Group/syrax/pull/270) |
| 32 MiB ordinary log backlog in a fresh Node process | Peak process RSS | 155,280 KiB | 85,504 KiB | About 45% lower. Elapsed time rose from 101 ms to 180 ms. Relevant decisions and the longest record still require memory. [#257](https://github.com/Jerome-Group/syrax/pull/257) |

The changes bound avoidable buffering rather than the largest possible input. A single very
large document, native embedding allocations and retained relevant log decisions can still
dominate a workload. No index geometry, similarity threshold or embedding model was changed
to obtain these reductions.

## Dependency decisions

Compatible updates were validated and merged: Prettier, Node types, Oxlint, SSE Starlette and
Hugging Face Hub ([#245](https://github.com/Jerome-Group/syrax/pull/245),
[#243](https://github.com/Jerome-Group/syrax/pull/243),
[#242](https://github.com/Jerome-Group/syrax/pull/242),
[#237](https://github.com/Jerome-Group/syrax/pull/237),
[#236](https://github.com/Jerome-Group/syrax/pull/236)). Hub's public tokenizer fetch was also
checked outside ordinary CI.

The separate Pydantic and core bumps could not coexist. A coherent Pydantic 2.13.5/core 2.46.5
update superseded both. The lock also restored mpmath 1.3.0 because SymPy 1.14.0 requires
mpmath below 1.4. A clean environment passed dependency consistency and the search suite.
[#256](https://github.com/Jerome-Group/syrax/pull/256)

ONNX Runtime 1.30.0 was deferred rather than merged against an existing index. Real-export
tests passed on both versions, but the fixed-input vector checksum changed from
`79f18d89fc5a5642` to `d6ef8f12f9d9032c`; both produced 47 windows and boundary checksum
`292cbf09e477ea11`. Passing tests therefore did not establish compatibility with stored vectors.
The bump was closed and the need for an explicit upgrade/rebuild decision recorded in
[#259](https://github.com/Jerome-Group/syrax/issues/259), following
[the fingerprint gate](../../CODING_STANDARDS.md#what-this-repositorys-ci-cannot-prove-and-what-stands-in-for-it).

The OpenClaw proposal was replaced with 2026.8.1 rather than 2026.9.5. The newer candidate
retried a silent rung before failover; disabling its provider retries also removed the required
interrupted-stream retry. Version 2026.8.1 passed both unchanged boundaries, and two independent
clean external installs reported zero npm audit vulnerabilities. The adapter adopts explicit
agent ownership and the runtime's unconditional redaction. Credential tests verify generated
references, actual authentication at the local provider wire, and absence of raw sentinel keys
in configuration, state, workspaces and logs. The migration and its evidence are recorded in
[#294](https://github.com/Jerome-Group/syrax/pull/294) and
[ADR-0036](../adr/0036-the-runtime-upgrade-preserves-the-lanes-failure-boundaries.md).
A future 2026.9.5 migration retains its unresolved compatibility gate in
[#269](https://github.com/Jerome-Group/syrax/issues/269).

All nine original Dependabot proposals were resolved: five merged directly, two were superseded
by the coherent search dependency update, one was deferred for an index rebuild decision, and
one was replaced by the compatible runtime migration. No Dependabot pull request remained open
at the completion check on 2026-09-26.

## Combined validation

The complete search source passed Ruff formatting and lint, and all 174 Python tests passed
with the public pinned export available, including the two tests ordinarily skipped by CI.
This ran on Python 3.14.6 with ONNX Runtime 1.24.1, tokenizers 0.23.1, NumPy 2.5.3 and
Hugging Face Hub 1.32.0. The fixed-input fingerprint matched the original pinned stack:
47 windows, boundary hash `292cbf09e477ea11`, vector checksum `79f18d89fc5a5642`.

The first complete gateway-backed candidate run passed 350 of 351 tests with no skips.
The remaining button test also failed independently: the fixture queued its next scripted reply
before the previous tool's model follow-up arrived. Tool delivery was not the end of that turn.
The correction synchronizes the fixture on the actual provider follow-up carrying that question
and its tool result, while retaining the acknowledgement and routing assertions.

The corrected complete candidate passed all 351 Node tests against the real isolated OpenClaw
2026.8.1 gateway, with zero failures or skips (352 seconds), on Node 26.4.0. Every provider and
Telegram wire was local. npm installation, formatting, lint and types also passed.

The validated Git tree `2e011d23bf9de2f9658ab5b43cc1fd6505dfba5a` exactly matches
[merged main commit `5bdf863`](https://github.com/Jerome-Group/syrax/commit/5bdf863ae195225d69017a07fcb0495b4a5bbfe8),
which includes all delivered implementation and dependency changes above. Each pull request passed its
required CI and conformance checks before merging at its reviewed head. This evidence note adds
only documentation.

The generator now targets the 2026.8.1 schema. An existing deployment must coordinate its runtime
installation and configuration regeneration with the source update; an older gateway cannot
consume that schema. This audit did not perform that rollout or rebuild the live search index.
