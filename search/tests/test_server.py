"""What the unit exposes, and what it deliberately does not."""

from __future__ import annotations

import asyncio
import os

import pytest
from starlette.testclient import TestClient

from syrax_search.benchmark import SHAPES
from syrax_search.building import FULL, INCREMENTAL
from syrax_search.server import SCOPE_HEADER, SearchUnit, UnknownScope, build


@pytest.fixture
def unit(machine, embedder) -> SearchUnit:
    return SearchUnit(machine, embedder)


def tools(unit: SearchUnit) -> dict:
    return {tool.name: tool for tool in asyncio.run(build(unit).list_tools())}


def test_the_unit_serves_exactly_the_tools_it_declares(unit):
    assert set(tools(unit)) == {"search", "choose", "capture", "read", "attach"}


def test_scope_is_not_a_parameter_the_model_can_supply(unit):
    """Were it one, a chat could widen its own reach in a single confused turn (ADR-0004)."""
    assert set(tools(unit)["search"].input_schema["properties"]) == {"query"}
    assert set(tools(unit)["choose"].input_schema["properties"]) == {"answer", "position"}
    assert set(tools(unit)["attach"].input_schema["properties"]) == {"path"}
    assert set(tools(unit)["capture"].input_schema["properties"]) == {"answer", "shape", "expect"}


def test_a_configured_scope_resolves_to_its_root(unit, machine):
    assert unit.scope_root("notes") == machine.scopes["notes"]
    assert unit.scope_root(None) is None


def test_an_unrecognised_scope_is_refused_rather_than_widened(unit):
    with pytest.raises(UnknownScope):
        unit.scope_root("everything")


def test_the_scope_header_is_what_binds_a_connection(unit):
    assert SCOPE_HEADER == "x-syrax-scope"


def test_a_pass_is_poked_over_http_and_is_no_agents_to_call(unit):
    assert "index" not in tools(unit)
    with TestClient(build(unit).streamable_http_app()) as client:
        accepted = client.post("/index/incremental")
        assert accepted.status_code == 202
        assert accepted.json() == {"pass": "incremental", "started": True}


def test_the_benchmark_is_scored_over_the_same_wire_and_is_no_agents_to_call(unit):
    """The score is read by whatever posts it, which is no more a model than a reindex is."""
    assert "benchmark" not in tools(unit)
    with TestClient(build(unit).streamable_http_app()) as client:
        scored = client.post("/benchmark")
        assert scored.status_code == 200
        assert scored.json()["confident_floor"]["applied"] is False


def test_the_five_shapes_are_the_schema_rather_than_a_model_s_wording(unit):
    """A sixth shape means the vocabulary was wrong, and is not a model's to invent (ADR-0007)."""
    assert tools(unit)["capture"].input_schema["properties"]["shape"]["enum"] == list(SHAPES)


def test_the_read_tool_takes_one_path(unit):
    assert set(tools(unit)["read"].input_schema["properties"]) == {"path"}


@pytest.mark.anyio
async def test_the_re_embed_pass_scores_the_set_and_the_hourly_one_does_not(unit, machine):
    """The three-day pass is the one that can have moved a number; nothing else is scheduled."""
    await unit.index(INCREMENTAL)
    assert not os.path.exists(machine.retrieval_report_path)

    await unit.index(FULL)
    assert os.path.exists(machine.retrieval_report_path)


@pytest.mark.anyio
async def test_index_pokes_reserve_before_the_worker_runs(unit, monkeypatch):
    from syrax_search.server import _start_pass

    gate = asyncio.Event()
    ran = []

    async def index(kind):
        ran.append(kind)
        await gate.wait()

    monkeypatch.setattr(unit, "index", index)
    assert _start_pass(unit, INCREMENTAL).status_code == 202
    assert unit.indexing, "benchmark must see the reserved pass before its worker starts"
    assert _start_pass(unit, FULL).status_code == 409
    assert ran == [], "no event-loop yield has occurred between these requests"
    await asyncio.sleep(0)
    assert ran == [INCREMENTAL]
    gate.set()
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert not unit.indexing


@pytest.mark.anyio
@pytest.mark.parametrize("outcome", ["success", "failure", "cancelled"])
async def test_a_finished_pass_releases_its_reservation(unit, monkeypatch, outcome, caplog):
    finished = asyncio.Event()
    tasks = []

    async def index(kind):
        tasks.append(asyncio.current_task())
        try:
            if outcome == "failure":
                raise RuntimeError("synthetic pass failure")
            if outcome == "cancelled":
                raise asyncio.CancelledError
        finally:
            finished.set()

    monkeypatch.setattr(unit, "index", index)
    assert unit.start_index(INCREMENTAL)
    await finished.wait()
    await asyncio.sleep(0)
    assert not unit.indexing
    if outcome == "failure":
        assert "Index pass failed" in caplog.text
    assert unit.start_index(FULL)
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert len(tasks) == 2
    assert not unit.indexing


@pytest.mark.anyio
async def test_document_read_leaves_the_event_loop_free_and_defers_sweep(unit, monkeypatch):
    import threading

    entered = threading.Event()
    release = threading.Event()
    swept = []
    event_loop_thread = threading.get_ident()

    def blocking_read(path):
        assert threading.get_ident() != event_loop_thread
        entered.set()
        assert release.wait(5), "the event loop must release a blocked read"
        return {"read": "ok", "path": path}

    monkeypatch.setattr(unit.reader, "read", blocking_read)
    monkeypatch.setattr(unit.reader, "sweep", lambda: swept.append(True))
    reading = asyncio.create_task(unit.read("/synthetic.md"))
    sweeping = None
    try:
        async with asyncio.timeout(2):
            while not entered.is_set():
                await asyncio.sleep(0.001)
            sweeping = asyncio.create_task(unit.sweep())
            await asyncio.sleep(0)
            assert swept == [], "cache sweep must wait for the in-flight reader"
            assert not reading.done()
    finally:
        release.set()
        result = await reading
        if sweeping is not None:
            await sweeping
    assert result == {"read": "ok", "path": "/synthetic.md"}
    assert swept == [True]


@pytest.mark.anyio
async def test_document_read_failure_releases_sqlite_serialization(unit, monkeypatch):
    def failed_read(path):
        raise RuntimeError("synthetic extraction failure")

    monkeypatch.setattr(unit.reader, "read", failed_read)
    with pytest.raises(RuntimeError, match="synthetic extraction failure"):
        await unit.read("/synthetic.md")
    monkeypatch.setattr(unit.reader, "read", lambda path: {"read": "ok"})
    async with asyncio.timeout(2):
        assert await unit.read("/synthetic.md") == {"read": "ok"}
        await unit.sweep()


@pytest.mark.anyio
@pytest.mark.parametrize("fails", [False, True])
async def test_cancelled_read_holds_serialization_until_its_worker_finishes(
    unit, monkeypatch, fails
):
    import threading

    entered = threading.Event()
    release = threading.Event()
    swept = []

    def blocking_read(path):
        entered.set()
        assert release.wait(5)
        if fails:
            raise RuntimeError("synthetic extraction failure after cancellation")
        return {"read": "ok"}

    monkeypatch.setattr(unit.reader, "read", blocking_read)
    monkeypatch.setattr(unit.reader, "sweep", lambda: swept.append(True))
    reading = asyncio.create_task(unit.read("/synthetic.md"))
    sweeping = None
    try:
        async with asyncio.timeout(2):
            while not entered.is_set():
                await asyncio.sleep(0.001)
            reading.cancel()
            await asyncio.sleep(0)
            sweeping = asyncio.create_task(unit.sweep())
            await asyncio.sleep(0)
            assert not reading.done()
            assert swept == []
            reading.cancel()
            await asyncio.sleep(0)
            assert not reading.done(), "repeated cancellation cannot release a running worker"
    finally:
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await reading
        if sweeping is not None:
            await sweeping
    assert swept == [True]
