"""Canonical location checks at the shared read/attachment policy seam."""

from __future__ import annotations

from dataclasses import replace

from syrax_search.reading import refused


def test_a_configured_excluded_location_is_refused_in_every_spelling(machine, tmp_path):
    location = tmp_path / "document-location"
    location.symlink_to(tmp_path / "private", target_is_directory=True)
    for path in (tmp_path / "private" / "diary.md", location / "diary.md"):
        result = refused(machine, str(path))
        assert result is not None
        assert "blocklist" in result["reason"]


def test_configured_exclusions_use_the_roots_canonical_location(machine, tmp_path):
    location = tmp_path / "document-location"
    location.symlink_to(tmp_path / "private", target_is_directory=True)
    config = replace(machine, lists=replace(machine.lists, blocked_roots=(str(location),)))
    result = refused(config, str(tmp_path / "private" / "diary.md"))
    assert result is not None
    assert "blocklist" in result["reason"]


def test_builtin_excluded_directories_are_checked_at_the_canonical_location(machine, tmp_path):
    excluded = tmp_path / ".excluded-location"
    excluded.mkdir()
    (excluded / "synthetic.md").touch()
    location = tmp_path / "document-location"
    location.symlink_to(excluded, target_is_directory=True)
    result = refused(machine, str(location / "synthetic.md"))
    assert result is not None
    assert "dot-directory" in result["reason"]


def test_permitted_locations_stay_permitted_through_directory_aliases(machine, tmp_path):
    location = tmp_path / "document-location"
    location.symlink_to(tmp_path / "outside", target_is_directory=True)
    assert refused(machine, str(location / "letter.md")) is None
