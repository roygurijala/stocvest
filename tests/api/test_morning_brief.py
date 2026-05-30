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
async def test_vix_fallback_prefers_indices_snapshot() -> None:
    class _FakeClient:
        def __init__(self) -> None:
            self.stock_calls: list[str] = []

        async def get_indices_snapshots(self, tickers: list[str]) -> dict[str, Snapshot]:
            assert tickers == list(VIX_SNAPSHOT_FALLBACK_SYMBOLS)
            return {
                "I:VIX": Snapshot(
                    symbol="I:VIX",
                    last_trade_price=18.42,
                    change_percent=0.5,
                    prev_close=18.0,
                )
            }

        async def get_snapshot(self, sym: str) -> Snapshot:
            self.stock_calls.append(sym)
            raise PolygonError("should not reach stocks when indices succeeds")

    out = await get_vix_snapshot_with_fallback(_FakeClient())
    assert out is not None and out.symbol == "I:VIX" and out.last_trade_price == 18.42


@pytest.mark.asyncio
async def test_vix_fallback_order_skips_unusable_then_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    """Design: try I:VIX then ^VIX then VIX; empty last price and PolygonError do not stop the chain."""

    async def _no_fred() -> None:
        return None

    monkeypatch.setattr("stocvest.api.services.morning_brief_fetch._fred_vix_snapshot", _no_fred)

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


@pytest.mark.asyncio
async def test_vix_fallback_accepts_day_close_without_last(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _no_fred() -> None:
        return None

    monkeypatch.setattr("stocvest.api.services.morning_brief_fetch._fred_vix_snapshot", _no_fred)

    class _FakeClient:
        async def get_snapshot(self, sym: str) -> Snapshot:
            if sym == "I:VIX":
                return Snapshot(symbol="I:VIX", last_trade_price=None, day_close=19.1, prev_close=18.8)
            raise PolygonError("skip")

    out = await get_vix_snapshot_with_fallback(_FakeClient())
    assert out is not None and out.day_close == 19.1


@pytest.mark.asyncio
async def test_vix_fallback_uses_fred_when_polygon_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeClient:
        async def get_indices_snapshots(self, tickers: list[str]) -> dict[str, Snapshot]:
            return {}

        async def get_snapshot(self, sym: str) -> Snapshot:
            raise PolygonError("404")

    async def _fake_fred() -> Snapshot:
        return Snapshot(
            symbol="I:VIX",
            last_trade_price=20.0,
            prev_close=20.2,
            change_percent=-0.99,
            market_status="fred_daily",
        )

    monkeypatch.setattr(
        "stocvest.api.services.morning_brief_fetch._fred_vix_snapshot",
        _fake_fred,
    )
    out = await get_vix_snapshot_with_fallback(_FakeClient())
    assert out is not None
    assert out.market_status == "fred_daily"
    assert out.last_trade_price == 20.0


@pytest.mark.asyncio
async def test_vix_fallback_prefers_polygon_over_fred(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeClient:
        async def get_indices_snapshots(self, tickers: list[str]) -> dict[str, Snapshot]:
            return {
                "I:VIX": Snapshot(symbol="I:VIX", last_trade_price=15.0, change_percent=1.0),
            }

        async def get_snapshot(self, sym: str) -> Snapshot:
            raise PolygonError("should not run")

    async def _fake_fred() -> Snapshot:
        raise AssertionError("FRED must not run when indices succeed")

    monkeypatch.setattr(
        "stocvest.api.services.morning_brief_fetch._fred_vix_snapshot",
        _fake_fred,
    )
    out = await get_vix_snapshot_with_fallback(_FakeClient())
    assert out is not None and out.last_trade_price == 15.0
