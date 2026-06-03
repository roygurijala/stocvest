"""Unit tests for the assistant discovery structured payload."""

from __future__ import annotations

from stocvest.api.services.assistant_discovery import (
    DiscoveryResult,
    DiscoveryRow,
    discovery_payload,
)


def test_discovery_payload_none_when_no_data() -> None:
    assert discovery_payload(DiscoveryResult()) is None


def test_discovery_payload_shapes_rows_and_scanner_href() -> None:
    result = DiscoveryResult(
        rows=[
            DiscoveryRow(symbol="NVDA", context="earnings, gap up 4.0%, strong setup"),
            DiscoveryRow(symbol="AVGO", context="guidance, moderate setup"),
        ],
        source="desk_cache",
        mode="day",
        generated_at="2026-06-03T13:30:00Z",
        has_data=True,
    )
    payload = discovery_payload(result)
    assert payload is not None
    assert payload["mode"] == "day"
    assert payload["scanner_href"] == "/dashboard/scanner?focus=day"
    assert payload["source"] == "desk_cache"
    assert payload["rows"][0] == {"symbol": "NVDA", "context": "earnings, gap up 4.0%, strong setup"}


def test_discovery_payload_normalizes_unknown_mode_to_day() -> None:
    result = DiscoveryResult(
        rows=[DiscoveryRow(symbol="X", context="active")],
        mode="weird",
        has_data=True,
    )
    payload = discovery_payload(result)
    assert payload is not None
    assert payload["mode"] == "day"
    assert payload["scanner_href"] == "/dashboard/scanner?focus=day"


def test_discovery_payload_swing_mode() -> None:
    result = DiscoveryResult(
        rows=[DiscoveryRow(symbol="X", context="active")],
        mode="swing",
        has_data=True,
    )
    payload = discovery_payload(result)
    assert payload is not None
    assert payload["mode"] == "swing"
    assert payload["scanner_href"] == "/dashboard/scanner?focus=swing"
