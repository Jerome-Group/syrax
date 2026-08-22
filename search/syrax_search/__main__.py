"""The unit's commands: serve it, index it, reset it, and fetch the export it needs once.

    python -m syrax_search serve          <deployment.json>
    python -m syrax_search index          <deployment.json> [incremental|full]
    python -m syrax_search reset          <deployment.json>
    python -m syrax_search fetch-embedder <deployment.json>

`serve` is what the LaunchAgent runs. `index` is here for the first build and for a person with a
reason; unattended passes go through the running unit instead, so they get the resident embedder
rather than loading a second copy of it (ADR-0005).
"""

from __future__ import annotations

import json
import sys

from .building import FULL, INCREMENTAL, run_pass
from .config import read_deployment
from .embedder import PinnedEmbedder
from .embedder_export import fetch
from .server import serve


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
    if command == "reset":
        from .building import reset

        reset(config)
        print(config.database_path)
        return 0
    if command == "index":
        kind = arguments[2] if len(arguments) > 2 else INCREMENTAL
        if kind not in (INCREMENTAL, FULL):
            print(f"a pass is {INCREMENTAL} or {FULL}, not {kind}", file=sys.stderr)
            return 2
        embedder = PinnedEmbedder(config.embedder_root, config.idle_evict_seconds)
        print(json.dumps(run_pass(config, embedder, kind).as_reply()))
        return 0

    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
