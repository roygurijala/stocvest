"""Gap intelligence earnings catalyst + pre-open volume gate."""

from __future__ import annotations

from datetime import date
from unittest.mock import patch

from stocvest.data.models import EarningsEvent, Snapshot
from stocvest.signals.day_trading_scanner import PremarketGapCandidate
from stocvest.signals.gap_intelligence import (
    _passes_volume_vs_adv_gate,
    build_gap_intelligence_items,
)


def _gap() -> PremarketGapCandidate:
    return PremarketGapCandidate(
        symbol="DELL",
        prev_close=100.0,
        premarket_price=105.0,
        gap_percent=5.0,
        day_volume=800_000,
        direction="up",
        rank_score=5.0,
    )


def test_passes_volume_gate_outside_rth_with_low_ratio() -> None:
    with patch("stocvest.signals.gap_intelligence._is_outside_rth_ny", return_value=True):
        assert _passes_volume_vs_adv_gate(0.1) is True


def test_build_gap_items_earnings_catalyst_without_news() -> None:
    earn = EarningsEvent(
        symbol="DELL",
        company_name="Dell",
        report_date=date(2026, 5, 27),
        report_time="after_market",
        actual_eps=1.1,
    )
    snap = Snapshot(
        symbol="DELL",
        company_name="Dell Technologies",
        prev_day_volume=10_000_000,
    )
    with patch("stocvest.signals.gap_intelligence._is_outside_rth_ny", return_value=True):
        items = build_gap_intelligence_items(
            [_gap()],
            {"DELL": snap},
            [],
            earnings_events=[earn],
            session_date=date(2026, 5, 28),
        )
    assert len(items) >= 1
    dell = next(i for i in items if i["symbol"] == "DELL")
    assert dell["has_catalyst"] is True
    assert dell["catalyst"]["category"] == "earnings"
