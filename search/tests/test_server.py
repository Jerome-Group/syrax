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
    assert set(tools(unit)["choose"].input_schema["properties"]) == {"choice"}
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
