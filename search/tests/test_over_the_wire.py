"""The unit answering a real MCP client over loopback, which is the only shape the agents see."""

from __future__ import annotations

import json
import socket
import threading
import time

import pytest
import uvicorn
from mcp.client.session import ClientSession
from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client

from syrax_search.building import INCREMENTAL, run_pass
from syrax_search.server import SCOPE_HEADER, SearchUnit, build


@pytest.fixture
def address(machine, embedder):
    run_pass(machine, embedder, INCREMENTAL)
    application = build(SearchUnit(machine, embedder)).streamable_http_app()
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(application, host="127.0.0.1", port=port, log_level="warning")
    )
    threading.Thread(target=server.run, daemon=True).start()
    _wait_for(port)
    yield f"http://127.0.0.1:{port}/mcp"
    server.should_exit = True


def _wait_for(port: int, seconds: float = 10.0) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return
        except OSError:
            time.sleep(0.05)
    raise TimeoutError(f"the unit never bound 127.0.0.1:{port}")


async def _call(address: str, name: str, arguments: dict, scope: str | None) -> dict:
    headers = {} if scope is None else {SCOPE_HEADER: scope}
    client = create_mcp_http_client(headers=headers)
    async with (
        streamable_http_client(address, http_client=client) as (read, write, *_),
        ClientSession(read, write) as session,
    ):
        await session.initialize()
        result = await session.call_tool(name, arguments)
        assert not result.is_error, result.content
        return json.loads(result.content[0].text)


@pytest.mark.anyio
async def test_search_answers_with_a_verdict_over_the_wire(address):
    reply = await _call(
        address, "search", {"query": "artin wedderburn theorem semisimple rings"}, None
    )
    assert reply["verdict"] == "confident"
    assert reply["results"][0]["name"] == "wedderburn.md"


@pytest.mark.anyio
async def test_read_answers_over_the_wire(address, tmp_path):
    path = str(tmp_path / "documents" / "notes" / "rowing.md")
    reply = await _call(address, "read", {"path": path}, None)
    assert reply["read"] == "ok"
    assert "erg splits" in reply["text"]


@pytest.mark.anyio
async def test_the_connection_carries_the_scope(address, machine):
    reply = await _call(address, "search", {"query": "receipt"}, "notes")
    notes = machine.scopes["notes"]
    assert all(one["path"].startswith(notes + "/") for one in reply["results"])
