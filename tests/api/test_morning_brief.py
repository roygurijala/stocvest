from __future__ import annotations

from datetime import date

import pytest

from stocvest.api.services.morning_brief_fetch import (
    VIX_SNAPSHOT_FALLBACK_SYMBOLS,
    get_vix_snapshot_with_fallback,
    morning_brief_context_from_payload_dict,
)
from stocvest.data.models import Snapshot
from stocvest.data.polygon_client import PolygonError
from stocvest.signals.morning_brief import MorningBriefContext, build_morning_brief_payload
from stocvest.signals.pdt_tracker import PDTAssessment


def _pdt(used: int, *, warn: bool = False, limit: bool = False) -> PDTAssessment:
    return PDTAssessment(
        pdt_exempt=False,
        day_trades_in_window=used,
        max_non_exempt=3,
        rolling_business_days=5,
        allow_next_day_trade=not limit,
        warn_near_limit=warn,
        at_limit=limit,
    )


def test_brief_contains_all_six_sections() -> None:
    ctx = MorningBriefContext(
        briefing_date=date(2026, 5, 2),
        futures_spy_pct=0.2,
        futures_qqq_pct=0.3,
        vix_level=18.0,
        vix_direction="flat",
        regime="Bullish",
        gap_intelligence_items=[
            {
                "symbol": "X",
                "has_catalyst": True,
                "gap_quality_score": 80,
                "gap_pct": 5.0,
                "current_price": 50.0,
                "volume_vs_avg": 2.0,
                "company_name": "Co",
                "catalyst": {"headline": "h", "sentiment": "bullish"},
            }
        ],
        pdt=_pdt(0),
    )
    out = build_morning_brief_payload(ctx)
    assert "generated_at" in out
    assert "conditions" in out
    assert "economic_events" in out
    assert "earnings_today" in out
    assert "top_watch" in out
    assert "best_setup" in out
    assert "pdt_status" in out


def test_favorable_conditions_when_bullish_low_vix() -> None:
    ctx = MorningBriefContext(
        briefing_date=date(2026, 5, 2),
        futures_spy_pct=0.4,
        futures_qqq_pct=0.5,
        vix_level=17.0,
        vix_direction="falling",
        regime="Bullish",
        pdt=None,
    )
    out = build_morning_brief_payload(ctx)
    assert out["conditions"]["label"] == "FAVORABLE"


def test_avoid_conditions_when_bearish_high_vix() -> None:
    ctx = MorningBriefContext(
        briefing_date=date(2026, 5, 2),
        futures_spy_pct=-0.5,
        futures_qqq_pct=-0.6,
        vix_level=28.0,
        vix_direction="rising",
        regime="Bearish",
        pdt=None,
    )
    out = build_morning_brief_payload(ctx)
    assert out["conditions"]["label"] == "AVOID"


def test_no_earnings_message_when_empty() -> None:
    ctx = MorningBriefContext(
        briefing_date=date(2026, 5, 2),
        futures_spy_pct=0.1,
        futures_qqq_pct=0.1,
        vix_level=19.0,
        vix_direction="flat",
        regime="Neutral",
        earnings_today=[],
        pdt=None,
    )
    out = build_morning_brief_payload(ctx)
    assert out["earnings_today"] == {"message": "No earnings today"}


def test_pdt_warning_at_two_trades() -> None:
    ctx = MorningBriefContext(
        briefing_date=date(2026, 5, 2),
        futures_spy_pct=0.1,
        futures_qqq_pct=0.1,
        vix_level=19.0,
        vix_direction="flat",
        regime="Neutral",
        pdt=_pdt(2, warn=True),
    )
    out = build_morning_brief_payload(ctx)
    assert out["pdt_status"]["status"] == "warning"
    assert "remaining" in out["pdt_status"]["message"].lower()


def test_pdt_blocked_at_three_trades() -> None:
    ctx = MorningBriefContext(
        briefing_date=date(2026, 5, 2),
        futures_spy_pct=0.1,
        futures_qqq_pct=0.1,
        vix_level=19.0,
        vix_direction="flat",
        regime="Neutral",
        pdt=_pdt(3, limit=True),
    )
    out = build_morning_brief_payload(ctx)
    assert out["pdt_status"]["status"] == "blocked"


def test_morning_brief_context_from_payload_dict_roundtrip() -> None:
    raw = {
        "futures_spy_pct": 0.1,
        "regime": "Neutral",
        "gap_intelligence_items": [{"symbol": "A", "has_catalyst": False, "gap_quality_score": 40}],
    }
    ctx = morning_brief_context_from_payload_dict(raw, date(2026, 5, 2), None)
    assert ctx.regime == "Neutral"
    assert len(ctx.gap_intelligence_items) == 1


@pytest.mark.asyncio
async def test_vix_fallback_order_skips_unusable_then_errors() -> None:
    """Design: try I:VIX then ^VIX then VIX; empty last price and PolygonError do not stop the chain."""

    class _FakeClient:
        def __init__(self) -> None:
            self.calls: list[str] = []

        async def get_snapshot(self, sym: str) -> Snapshot:
            self.calls.append(sym)
            if sym == "I:VIX":
                return Snapshot(symbol="I:VIX", last_trade_price=None)
            if sym == "^VIX":
                raise PolygonError("Polygon 404")
            return Snapshot(symbol="VIX", last_trade_price=19.5)

    c = _FakeClient()
    out = await get_vix_snapshot_with_fallback(c)
    assert out is not None and out.symbol == "VIX" and out.last_trade_price == 19.5
    assert c.calls == list(VIX_SNAPSHOT_FALLBACK_SYMBOLS)
