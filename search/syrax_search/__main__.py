"""The unit's commands: serve it, poke it, index it, reset it, and fetch its export once.

    python -m syrax_search serve          <deployment.json>
    python -m syrax_search poke           <deployment.json> [incremental|full]
    python -m syrax_search index          <deployment.json> [incremental|full]
    python -m syrax_search reset          <deployment.json>
    python -m syrax_search fingerprint    <deployment.json>
    python -m syrax_search fetch-embedder <deployment.json>

`fingerprint` is what decides a bump to `tokenizers` or `onnxruntime`: run it before and after, and
identical output means the index is unaffected.

`serve` is what the LaunchAgent runs. `poke` is a re-embed asked for on demand: it hands the pass to
the unit that is already running, which is what the two schedules do and the reason neither a poke
nor this command is a launchd unit of its own (ADR-0007). `index` is the same pass in this process,
here for the first build and for a person with a reason — it loads a second copy of the 698 MB
embedder, which is what the resident unit exists to avoid (ADR-0005).
"""

from __future__ import annotations

import json
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .building import FULL, INCREMENTAL, run_pass
from .config import SearchConfig, read_deployment
from .embedder import PinnedEmbedder
from .embedder_export import fetch
from .fingerprint import fingerprint
from .server import serve


def poke(config: SearchConfig, route: str) -> int:
    """Ask the running unit to do it. A unit that is not up says so rather than doing it here."""
    try:
        with urlopen(Request(f"http://127.0.0.1:{config.port}{route}", method="POST")) as reply:
            print(reply.read().decode())
            return 0
    except HTTPError as refused:
        print(refused.read().decode(), file=sys.stderr)
        return 1
    except URLError as unreachable:
        print(f"nothing is serving 127.0.0.1:{config.port}: {unreachable.reason}", file=sys.stderr)
        return 1


def main(arguments: list[str]) -> int:
    if len(arguments) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    command, deployment_path = arguments[0], arguments[1]
    config = read_deployment(deployment_path)

    if command == "serve":
        serve(config)
        return 0
    if command == "fetch-embedder":
        for written in fetch(config.embedder_root):
            print(written)
        return 0
    if command == "fingerprint":
        embedder = PinnedEmbedder(config.embedder_root, config.idle_evict_seconds)
        print(json.dumps(fingerprint(embedder)))
        return 0
    if command == "reset":
        from .building import reset

        reset(config)
        print(config.database_path)
        return 0
    if command in ("poke", "index"):
        kind = arguments[2] if len(arguments) > 2 else INCREMENTAL
        if kind not in (INCREMENTAL, FULL):
            print(f"a pass is {INCREMENTAL} or {FULL}, not {kind}", file=sys.stderr)
            return 2
        if command == "poke":
            return poke(config, f"/index/{kind}")
        embedder = PinnedEmbedder(config.embedder_root, config.idle_evict_seconds)
        print(json.dumps(run_pass(config, embedder, kind).as_reply()))
        return 0

    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
