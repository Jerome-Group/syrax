"""The resident unit: the tools over MCP on loopback, and the passes launchd pokes.

MCP's usual transport has the client spawn the server as a child process. Syrax has four agents, so
that default would put four ONNX embedders resident on a 16 GB machine (ADR-0005). This one is
standalone and bound to loopback instead, so there is one model however many agents connect, and it
survives a gateway restart rather than re-paying the load the resident process exists to avoid.

**Scope is bound by the connection an agent's client is configured with, never by an argument.**
The academic chat's entry carries `X-Syrax-Scope`; General's carries none and reaches the whole
allowlist. Were scope a tool parameter, the capability boundary would be model-settable and a chat
could widen its own reach in one confused turn — so an unrecognised scope is refused rather than
widened to everything.

The index passes and the benchmark run are plain HTTP rather than tools, for the same reason from
the other direction: a reindex is launchd's or the Owner's to trigger and no agent's to call, and a
score is read by whatever posts it rather than by a model.
"""

from __future__ import annotations

import asyncio

import anyio
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.context import Context
from starlette.requests import Request
from starlette.responses import JSONResponse

from .benchmark import FAILURES, Shape
from .building import FULL, INCREMENTAL, PassReport, run_pass
from .capture import Answers
from .config import SearchConfig
from .embedder import Embedder, PinnedEmbedder
from .index import open_index
from .reading import Reader
from .report import RetrievalReport
from .report import run as score_benchmark
from .retrieval import search as search_index
from .shortlist import Shortlists, token_of
from .staging import Staging

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
        self.answers = Answers(config.benchmark_path)
        self.shortlists = Shortlists()
        self.staging = Staging(config)
        self._querying = asyncio.Lock()
        self._indexing = asyncio.Lock()

    @property
    def indexing(self) -> bool:
        return self._indexing.locked()

    async def search(self, query: str, scope_name: str | None) -> dict:
        scope = self.scope_root(scope_name)
        async with self._querying:
            vector = await anyio.to_thread.run_sync(self.embedder.embed_query, query)
            verdict = search_index(self.database, query, vector, scope)
            answer = self.answers.remember(query, scope, verdict)
            return self.shortlists.offer(verdict, scope, answer.token) | {"answer": answer.token}

    def choose(self, choice: str, scope_name: str | None) -> dict:
        resolved = self.shortlists.resolve(choice, self.scope_root(scope_name))
        if resolved["choice"] == "declined":
            # The Owner rejecting every candidate is a miss whose shape is already known, so it is
            # captured here rather than parsed: no model sees this tap, and none has to (ADR-0007).
            self.answers.capture(token_of(choice), "not-in-the-shortlist")
        return resolved

    def capture(self, answer: str, shape: str, expect: str | None) -> dict:
        return self.answers.capture(answer, shape, expect)

    async def read(self, path: str) -> dict:
        async with self._querying:
            return self.reader.read(path)

    async def attach(self, path: str) -> dict:
        return await anyio.to_thread.run_sync(self.staging.attach, path)

    async def index(self, kind: str) -> PassReport:
        async with self._indexing:
            report = await anyio.to_thread.run_sync(run_pass, self.config, self.embedder, kind)
        # The benchmark is scored on the index's own re-embed pass, which is the one that can have
        # moved a number, and on demand — never on a schedule of its own (ADR-0007).
        if kind == FULL:
            await self.score()
        return report

    async def score(self) -> RetrievalReport:
        """Every entry in the set, re-asked against the index as it stands. Nothing is applied."""
        async with self._querying:
            return await anyio.to_thread.run_sync(score_benchmark, self.config, self.embedder)

    def scope_root(self, name: str | None) -> str | None:
        if name is None:
            return None
        if name not in self.config.scopes:
            raise UnknownScope(f"This connection names a scope, {name}, that is not configured.")
        return self.config.scopes[name]

    def sweep(self) -> None:
        self.reader.sweep()
        self.answers.sweep()
        self.shortlists.sweep()
        self.staging.sweep()
        self.embedder.release_if_idle()


def build(unit: SearchUnit) -> MCPServer:
    server = MCPServer("syrax-search", instructions=_INSTRUCTIONS)

    @server.tool(
        name="search",
        description=(
            "Find documents by what they are about or by what they are called. Returns a verdict: "
            "`confident` names one document, `ambiguous` offers up to three candidates to choose "
            "between — each carrying the `choice` value a tap on it sends back — and `empty` means "
            "nothing indexed answers this. A result marked "
            "`contents_indexed: false` is known by its name alone — it exists, and what is inside "
            "it has not been read. Every reply carries an `answer` value, which is the thing "
            "`capture` records a wrong result against."
        ),
    )
    async def search(query: str, context: Context) -> dict:
        return await unit.search(query, _scope_of(context))

    @server.tool(
        name="choose",
        description=(
            "Turn a tap on one of `search`'s candidates back into the document it stands for. "
            "Pass the `choice` value the button carried. `chosen` names one document, `declined` "
            "means none of them was wanted, and `expired` means the shortlist is gone — say so "
            "and offer to search again rather than acting on it."
        ),
    )
    async def choose(choice: str, context: Context) -> dict:
        return unit.choose(choice, _scope_of(context))

    @server.tool(
        name="capture",
        description=(
            "Record that one of `search`'s answers was wrong. Use it when the Owner replies to a "
            "result to say so, and never otherwise: nothing here is inferred from how a message "
            "reads. Pass the `answer` value that search's reply carried and the `shape` that fits "
            "— " + ", ".join(f"`{one.shape}` ({one.what})" for one in FAILURES) + ". `expect` is "
            "the absolute path that should have come back, if the Owner named one; leave it out "
            "rather than asking for it. `expired` means the answer is too old to record against, "
            "and `already` that this one is recorded."
        ),
    )
    async def capture(answer: str, shape: Shape, expect: str | None = None) -> dict:
        return unit.capture(answer, shape, expect)

    @server.tool(
        name="attach",
        description=(
            "Put one document where it can be sent to the chat, and return the path to send. Use "
            "it for any document that is going to the Owner as a file; the original is never sent "
            "from where it lives. Refuses exactly what `read` refuses."
        ),
    )
    async def attach(path: str) -> dict:
        return await unit.attach(path)

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

    # Awaited rather than accepted, unlike a pass: scoring the set is one query per entry against an
    # index that is already built, and what pokes it is waiting to read the numbers back. A pass in
    # flight is refused rather than scored through, because a number read off a half-rebuilt index
    # moves for a reason that has nothing to do with retrieval — and moving is what gets posted.
    @server.custom_route("/benchmark", methods=["POST"])
    async def benchmark(request: Request) -> JSONResponse:
        if unit.indexing:
            return JSONResponse({"scored": False, "reason": "already indexing"}, 409)
        return JSONResponse((await unit.score()).as_reply())

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
    "than a ranked list, `choose` turns a tap on one of its candidates back into a document, "
    "`read` returns a document's text and `attach` puts one where it can be sent. The scope all "
    "of it covers is fixed by this connection rather than by you. `capture` records a result the "
    "Owner has said was wrong."
)
