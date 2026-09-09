"""Tests for the assistant position gem discovery + lookup service (ADR-004 POS-D10)."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

import stocvest.api.services.assistant_position_discovery as gem_mod
from stocvest.api.services.assistant_position_discovery import (
    fetch_gem_lookup_context,
    fetch_position_gem_context,
    gem_lookup_payload,
    position_gem_payload,
    serialize_gem_lookup_context,
    serialize_position_gem_context,
)
from stocvest.api.services.position_scan import GemCandidate, PositionScanSnapshot

pytestmark = pytest.mark.unit


def _candidate(symbol: str, tier: str, *, rank: float = 50.0, fund_verdict: str = "bullish") -> GemCandidate:
    return GemCandidate(
        symbol=symbol,
        tier=tier,
        rank=rank,
        composite_score=40,
        verdict="bullish",
        fundamentals_score=78,
        fundamentals_verdict=fund_verdict,
        technical_score=70,
        technical_verdict="bullish",
        sector_verdict="bullish",
        data_quality="high",
        weakest_pillar_id="F4",
        weakest_pillar_label="Valuation",
        rs_vs_spy_6m_pct=12.0,
        signal_valid_days=90,
        why=f"{symbol} qualifies on all gates.",
        pillars=[
            {"pillar_id": "F1", "label": "Profitability", "score": 82, "verdict": "bullish"},
            {"pillar_id": "F4", "label": "Valuation", "score": 48, "verdict": "neutral"},
        ],
        failing_gates=[],
    )


def _snapshot(candidates: list[GemCandidate]) -> PositionScanSnapshot:
    return PositionScanSnapshot(
        generated_at=datetime(2026, 9, 5, 20, 10, tzinfo=timezone.utc),
        universe_size=25,
        candidates=candidates,
    )


def _patch_snapshot(monkeypatch: pytest.MonkeyPatch, snapshot: PositionScanSnapshot | None) -> None:
    monkeypatch.setattr(gem_mod, "get_cached_position_scan_snapshot", lambda: snapshot)


# ── Journey A — discovery ─────────────────────────────────────────────────────


def test_discovery_lists_gems_then_strong(monkeypatch: pytest.MonkeyPatch) -> None:
    snap = _snapshot(
        [
            _candidate("MSFT", "gem", rank=90),
            _candidate("AAPL", "gem", rank=80),
            _candidate("KO", "strong", rank=60),
            _candidate("XOM", "monitor", rank=30),
        ]
    )
    _patch_snapshot(monkeypatch, snap)
    result = fetch_position_gem_context(limit=6)
    assert result.has_data is True
    syms = [r.symbol for r in result.rows]
    # Gems first (in snapshot order), then strong; monitor excluded.
    assert syms == ["MSFT", "AAPL", "KO"]

    block = serialize_position_gem_context(result)
    assert "=== POSITION GEM CANDIDATES" in block
    assert "MSFT: tier=gem" in block
    assert "KO: tier=strong" in block
    assert "invest_href=/dashboard/invest" in block

    payload = position_gem_payload(result)
    assert payload is not None
    assert payload["rows"][0]["symbol"] == "MSFT"
    assert payload["invest_href"] == "/dashboard/invest"


def test_discovery_empty_when_no_gem_or_strong(monkeypatch: pytest.MonkeyPatch) -> None:
    snap = _snapshot([_candidate("XOM", "monitor"), _candidate("T", "insufficient")])
    _patch_snapshot(monkeypatch, snap)
    result = fetch_position_gem_context()
    assert result.has_data is False
    assert result.source == "empty"
    # Empty still emits a note so the model routes correctly.
    block = serialize_position_gem_context(result)
    assert "source=empty" in block
    assert position_gem_payload(result) is None


def test_discovery_not_loaded_when_cache_cold(monkeypatch: pytest.MonkeyPatch) -> None:
    """Cold cache degrades gracefully — no fresh scan is triggered in a chat turn."""
    _patch_snapshot(monkeypatch, None)
    result = fetch_position_gem_context()
    assert result.has_data is False
    assert result.source == "not_loaded"
    block = serialize_position_gem_context(result)
    assert "source=not_loaded" in block
    assert "/dashboard/invest" in block
    assert position_gem_payload(result) is None


def test_discovery_swallows_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    def _boom():  # type: ignore[no-untyped-def]
        raise RuntimeError("scan down")

    monkeypatch.setattr(gem_mod, "get_cached_position_scan_snapshot", _boom)
    result = fetch_position_gem_context()
    assert result.has_data is False
    assert result.source == "error"
    assert serialize_position_gem_context(result) == ""


# ── Journey B — single-name lookup ────────────────────────────────────────────


def test_lookup_found_cites_tier_and_pillars(monkeypatch: pytest.MonkeyPatch) -> None:
    snap = _snapshot([_candidate("MSFT", "gem"), _candidate("XOM", "monitor")])
    _patch_snapshot(monkeypatch, snap)
    result = fetch_gem_lookup_context("msft")
    assert result.found is True
    assert result.tier == "gem"

    block = serialize_gem_lookup_context(result)
    assert "=== POSITION GEM LOOKUP (MSFT) ===" in block
    assert "tier=gem" in block
    assert "pillar F4 Valuation" in block

    payload = gem_lookup_payload(result)
    assert payload is not None
    assert payload["on_gem_list"] is True
    assert payload["tier"] == "gem"


def test_lookup_not_on_universe_offers_position_tab(monkeypatch: pytest.MonkeyPatch) -> None:
    snap = _snapshot([_candidate("MSFT", "gem")])
    _patch_snapshot(monkeypatch, snap)
    result = fetch_gem_lookup_context("TSLA")
    assert result.found is False
    assert result.source == "not_on_universe"

    block = serialize_gem_lookup_context(result)
    assert "on_gem_list=false" in block
    assert "not in the current weekly position universe" in block
    # Never guesses a tier.
    assert "tier=" not in block

    payload = gem_lookup_payload(result)
    assert payload is not None
    assert payload["on_gem_list"] is False
    assert payload["tier"] is None


def test_lookup_not_loaded_when_cache_cold(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_snapshot(monkeypatch, None)
    result = fetch_gem_lookup_context("MSFT")
    assert result.found is False
    assert result.source == "not_loaded"
    block = serialize_gem_lookup_context(result)
    assert "source=not_loaded" in block
    # Never guesses a tier while the scan is cold.
    assert "tier=" not in block


def test_lookup_blank_symbol_is_error(monkeypatch: pytest.MonkeyPatch) -> None:
    result = fetch_gem_lookup_context("   ")
    assert result.source == "error"
    assert serialize_gem_lookup_context(result) == ""
    assert gem_lookup_payload(result) is None
