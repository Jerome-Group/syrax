"""The resident unit: two tools over MCP on loopback, and the index passes launchd pokes.

MCP's usual transport has the client spawn the server as a child process. Syrax has four agents, so
that default would put four ONNX embedders resident on a 16 GB machine (ADR-0005). This one is
standalone and bound to loopback instead, so there is one model however many agents connect, and it
survives a gateway restart rather than re-paying the load the resident process exists to avoid.

**Scope is bound by the connection an agent's client is configured with, never by an argument.**
The academic chat's entry carries `X-Syrax-Scope`; General's carries none and reaches the whole
allowlist. Were scope a tool parameter, the capability boundary would be model-settable and a chat
could widen its own reach in one confused turn — so an unrecognised scope is refused rather than
widened to everything.

The index passes are plain HTTP rather than tools, for the same reason from the other direction: a
reindex is launchd's to trigger and no agent's to call.
"""

from __future__ import annotations

import asyncio

import anyio
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.context import Context
from starlette.requests import Request
from starlette.responses import JSONResponse

from .building import FULL, INCREMENTAL, PassReport, run_pass
from .config import SearchConfig
from .embedder import Embedder, PinnedEmbedder
from .index import open_index
from .reading import Reader
from .retrieval import search as search_index

SCOPE_HEADER = "x-syrax-scope"
SWEEP_SECONDS = 60


class UnknownScope(Exception):
    pass


class SearchUnit:
    """One database, one embedder, one reader — the things that must exist exactly once."""

    def __init__(self, config: SearchConfig, embedder: Embedder | None = None) -> None:
        self.config = config
        self.embedder = embedder or PinnedEmbedder(config.embedder_root, config.idle_evict_seconds)
        self.database = open_index(config.database_path)
        self.reader = Reader(config, self.database)
        self._querying = asyncio.Lock()
        self._indexing = asyncio.Lock()

    @property
    def indexing(self) -> bool:
        return self._indexing.locked()

    async def search(self, query: str, scope_name: str | None) -> dict:
        scope = self.scope_root(scope_name)
        async with self._querying:
            vector = await anyio.to_thread.run_sync(self.embedder.embed_query, query)
            return search_index(self.database, query, vector, scope).as_reply()

    async def read(self, path: str) -> dict:
        async with self._querying:
            return self.reader.read(path)

    async def index(self, kind: str) -> PassReport:
        async with self._indexing:
            return await anyio.to_thread.run_sync(run_pass, self.config, self.embedder, kind)

    def scope_root(self, name: str | None) -> str | None:
        if name is None:
            return None
        if name not in self.config.scopes:
            raise UnknownScope(f"This connection names a scope, {name}, that is not configured.")
        return self.config.scopes[name]

    def sweep(self) -> None:
        self.reader.sweep()
        self.embedder.release_if_idle()


def build(unit: SearchUnit) -> MCPServer:
    server = MCPServer("syrax-search", instructions=_INSTRUCTIONS)

    @server.tool(
        name="search",
        description=(
            "Find documents by what they are about or by what they are called. Returns a verdict: "
            "`confident` names one document, `ambiguous` offers up to three candidates to choose "
            "between, `empty` means nothing indexed answers this. A result marked "
            "`contents_indexed: false` is known by its name alone — it exists, and what is inside "
            "it has not been read."
        ),
    )
    async def search(query: str, context: Context) -> dict:
        return await unit.search(query, _scope_of(context))

    @server.tool(
        name="read",
        description=(
            "Return the text of one document by absolute path. It reaches files the index does "
            "not hold; some paths are refused outright and the refusal says which."
        ),
    )
    async def read(path: str) -> dict:
        return await unit.read(path)

    @server.custom_route("/index/incremental", methods=["POST"])
    async def incremental(request: Request) -> JSONResponse:
        return _start_pass(unit, INCREMENTAL)

    @server.custom_route("/index/full", methods=["POST"])
    async def full(request: Request) -> JSONResponse:
        return _start_pass(unit, FULL)

    return server


def _scope_of(context: Context) -> str | None:
    headers = context.headers or {}
    return headers.get(SCOPE_HEADER)


def _start_pass(unit: SearchUnit, kind: str) -> JSONResponse:
    """Accepted rather than awaited: a full pass is hours, and a poke is not a request to wait."""
    if unit.indexing:
        return JSONResponse({"pass": kind, "started": False, "reason": "already indexing"}, 409)
    asyncio.get_running_loop().create_task(unit.index(kind))
    return JSONResponse({"pass": kind, "started": True}, 202)


def serve(config: SearchConfig, embedder: Embedder | None = None) -> None:
    import uvicorn

    unit = SearchUnit(config, embedder)
    application = build(unit).streamable_http_app()

    async def sweep() -> None:
        while True:
            await asyncio.sleep(SWEEP_SECONDS)
            unit.sweep()

    async def main() -> None:
        server = uvicorn.Server(
            uvicorn.Config(application, host="127.0.0.1", port=config.port, log_level="info")
        )
        async with anyio.create_task_group() as tasks:
            tasks.start_soon(sweep)
            await server.serve()
            tasks.cancel_scope.cancel()

    asyncio.run(main())


_INSTRUCTIONS = (
    "Syrax's file search over the Owner's own documents. `search` answers with a verdict rather "
    "than a ranked list, and the scope it covers is fixed by this connection rather than by you."
)
