"""The commands a person runs, and the one that hands work to the unit already running."""

from __future__ import annotations

import json
import socketserver
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import ClassVar

import pytest

from syrax_search.__main__ import main


class _Unit(HTTPServer):
    """`HTTPServer` resolves its own hostname on bind, which is a 35-second stall on a laptop."""

    def server_bind(self) -> None:
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address


class _Poked(BaseHTTPRequestHandler):
    routes: ClassVar[list[str]] = []

    def do_POST(self) -> None:
        _Poked.routes.append(self.path)
        self.send_response(202)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"pass": "full", "started": True}).encode())

    def log_message(self, *arguments) -> None:
        return


@pytest.fixture
def unit_at(tmp_path):
    """A stand-in for the resident unit, and a deployment naming the port it is on."""
    _Poked.routes = []
    server = _Unit(("127.0.0.1", 0), _Poked)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield _deployment_on(tmp_path, server.server_address[1])
    server.shutdown()


def _deployment_on(tmp_path, port: int | None) -> str:
    source = json.loads((tmp_path / "deployment.json").read_text())
    written = tmp_path / "deployment-with-port.json"
    written.write_text(json.dumps(source | ({} if port is None else {"searchPort": port})))
    return str(written)


def test_a_re_embed_asked_for_on_demand_pokes_the_running_unit(machine, unit_at):
    """A second copy of the pipeline here would load a second 698 MB embedder beside the first."""
    assert main(["poke", unit_at, "full"]) == 0
    assert _Poked.routes == ["/index/full"]


def test_a_poke_defaults_to_the_pass_the_hourly_schedule_asks_for(machine, unit_at):
    assert main(["poke", unit_at]) == 0
    assert _Poked.routes == ["/index/incremental"]


def test_a_poke_at_a_unit_that_is_not_up_fails_rather_than_indexing_here(machine, tmp_path):
    # Port 1 is privileged and nothing of Syrax's is ever on it, so this reaches nothing.
    assert main(["poke", _deployment_on(tmp_path, 1)]) == 1


def test_a_pass_that_is_not_one_of_the_two_is_refused(machine, tmp_path):
    assert main(["poke", _deployment_on(tmp_path, None), "everything"]) == 2


def test_seed_fills_the_set_from_a_list_of_queries(machine, embedder, tmp_path, monkeypatch):
    """A person's command: it runs each query, so the entry holds what the index scored it at."""
    from syrax_search import __main__ as commands
    from syrax_search.benchmark import entries
    from syrax_search.building import INCREMENTAL, run_pass

    run_pass(machine, embedder, INCREMENTAL)
    monkeypatch.setattr(commands, "PinnedEmbedder", lambda *_: embedder)
    source = tmp_path / "queries.jsonl"
    source.write_text(
        json.dumps({"query": "artin wedderburn theorem semisimple rings", "expect": ["wedderburn"]})
        + "\n"
    )

    assert main(["seed", str(tmp_path / "deployment.json"), str(source)]) == 0
    assert [one.query for one in entries(machine.benchmark_path)] == [
        "artin wedderburn theorem semisimple rings"
    ]


def test_seed_without_a_list_of_queries_says_so(machine, tmp_path):
    assert main(["seed", str(tmp_path / "deployment.json")]) == 2
