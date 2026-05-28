"""Opportunity Desk symbols merged into scheduled scanner universe."""

from __future__ import annotations

import pytest

from stocvest.api.services.opportunity_desk.scanner_universe import desk_universe_symbols_from_cache
from stocvest.api.services.scanner_scheduled_pipeline import merge_scheduled_scan_symbol_universe


def test_merge_scheduled_scan_includes_desk_movers() -> None:
    out = merge_scheduled_scan_symbol_universe(["CFG1"], ["WL1"], ["MU", "AMD"], cap=50)
    assert out[0] == "CFG1"
    assert "MU" in out
    assert "WL1" in out
    assert "SPY" in out
    assert len(out) <= 50


def test_desk_universe_symbols_from_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    def _read(_key: str) -> dict:
        return {
            "data": {
                "discovery": [{"symbol": "MU"}],
                "movers_radar": [{"symbol": "NVDA"}],
                "quiet_leaders": [{"symbol": "MRVL"}],
            }
        }

    monkeypatch.setattr(
        "stocvest.api.services.opportunity_desk.scanner_universe.read_dashboard_cache",
        _read,
    )
    syms = desk_universe_symbols_from_cache(limit=10)
    assert syms == ["MU", "NVDA", "MRVL"]


def test_merge_scheduled_scan_reserves_watchlist_slots() -> None:
    platform = [f"WL{i}" for i in range(15)]
    desk = [f"MV{i}" for i in range(40)]
    out = merge_scheduled_scan_symbol_universe([], platform, desk, cap=20, watchlist_reserve=10)
    assert len(out) == 20
    assert out[0] == "WL0"
    assert "WL9" in out
