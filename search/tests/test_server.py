"""What the unit exposes, and what it deliberately does not."""

from __future__ import annotations

import asyncio

import pytest
from starlette.testclient import TestClient

from syrax_search.server import SCOPE_HEADER, SearchUnit, UnknownScope, build


@pytest.fixture
def unit(machine, embedder) -> SearchUnit:
    return SearchUnit(machine, embedder)


def tools(unit: SearchUnit) -> dict:
    return {tool.name: tool for tool in asyncio.run(build(unit).list_tools())}


def test_the_unit_serves_exactly_the_four_tools_it_declares(unit):
    assert set(tools(unit)) == {"search", "choose", "read", "attach"}


def test_scope_is_not_a_parameter_the_model_can_supply(unit):
    """Were it one, a chat could widen its own reach in a single confused turn (ADR-0004)."""
    assert set(tools(unit)["search"].input_schema["properties"]) == {"query"}
    assert set(tools(unit)["choose"].input_schema["properties"]) == {"choice"}
    assert set(tools(unit)["attach"].input_schema["properties"]) == {"path"}


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


def test_the_read_tool_takes_one_path(unit):
    assert set(tools(unit)["read"].input_schema["properties"]) == {"path"}
