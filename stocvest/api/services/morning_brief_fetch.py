"""Assemble :class:`MorningBriefContext` from Polygon (and optional test overrides)."""

from __future__ import annotations

import asyncio
from datetime import date
from typing import Any

from stocvest.data import PolygonClient, PolygonError
from stocvest.data.models import EarningsEvent, Snapshot
from stocvest.data.scanner_universe import LIQUID_SYMBOLS_FALLBACK
from stocvest.signals.day_trading_scanner import dynamic_gap_candidates_from_snapshots
from stocvest.signals.gap_intelligence import build_gap_intelligence_items
from stocvest.signals.morning_brief import (
    EarningsBriefRow,
    EconomicEventBrief,
    MorningBriefContext,
    infer_regime,
    vix_direction_from_change,
)
from stocvest.signals.pdt_tracker import PDTAssessment
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


async def _load_snapshots_for_dynamic_gaps() -> list[Snapshot]:
    settings = get_settings()
    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        try:
            return await client.get_us_stocks_market_snapshots(include_otc=False)
        except PolygonError as exc:
            msg = str(exc)
            if "Polygon 403" in msg or "Polygon 401" in msg:
                _LOG.warning("US snapshot aggregate unavailable; using fallback universe")
                return await client.get_snapshots_many(list(LIQUID_SYMBOLS_FALLBACK), chunk_size=50)
            raise


def _pct_from_snapshot(s: Snapshot | None) -> float | None:
    if s is None:
        return None
    if s.pre_market_change_percent is not None:
        return float(s.pre_market_change_percent)
    if s.change_percent is not None:
        return float(s.change_percent)
    return None


def _earnings_time_label(ev: EarningsEvent) -> str:
    m = {
        "before_market": "BMO",
        "after_market": "AMC",
        "during_market": "DURING",
        "unknown": "TBD",
    }
    return m.get(ev.report_time, "TBD")


async def fetch_morning_brief_context_live(
    briefing_date: date,
    pdt: PDTAssessment | None,
) -> MorningBriefContext:
    settings = get_settings()
    symbols_earn = list(LIQUID_SYMBOLS_FALLBACK)

    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        spy, qqq = await asyncio.gather(
            client.get_snapshot("SPY"),
            client.get_snapshot("QQQ"),
        )
        vix_snap = None
        for vix_sym in ("I:VIX", "^VIX", "VIX"):
            try:
                vix_snap = await client.get_snapshot(vix_sym)
                if vix_snap and vix_snap.last_trade_price:
                    break
            except PolygonError:
                continue

        econ_rows = await client.get_economic_calendar_for_day(briefing_date)
        earn_rows = await client.get_earnings_calendar(
            symbols=symbols_earn,
            from_date=briefing_date,
            to_date=briefing_date,
        )
        news = await client.get_news(limit=400)

    snaps = await _load_snapshots_for_dynamic_gaps()
    gaps = dynamic_gap_candidates_from_snapshots(
        snaps,
        limit=40,
        min_abs_gap_percent=2.0,
        min_day_volume=500_000.0,
        min_trade_price=5.0,
    )
    sym_map = {s.symbol: s for s in snaps}
    gap_items = build_gap_intelligence_items(gaps, sym_map, news)

    spy_pct = _pct_from_snapshot(spy)
    qqq_pct = _pct_from_snapshot(qqq)
    vix_level = float(vix_snap.last_trade_price) if vix_snap and vix_snap.last_trade_price else None
    vix_chg = float(vix_snap.change_percent) if vix_snap and vix_snap.change_percent is not None else None
    regime = infer_regime(spy_pct, qqq_pct, vix_level)

    econ_brief = [
        EconomicEventBrief(time=e.time_et, event_name=e.event_name, impact=e.impact) for e in econ_rows[:3]
    ]
    earn_today = [
        EarningsBriefRow(
            symbol=e.symbol,
            company=e.company_name,
            time=_earnings_time_label(e),
            est_eps=e.estimated_eps,
        )
        for e in earn_rows
        if e.report_date == briefing_date
    ]

    return MorningBriefContext(
        briefing_date=briefing_date,
        futures_spy_pct=spy_pct,
        futures_qqq_pct=qqq_pct,
        vix_level=vix_level,
        vix_direction=vix_direction_from_change(vix_chg),
        regime=regime,
        economic_events=econ_brief,
        earnings_today=earn_today,
        gap_intelligence_items=gap_items,
        pdt=pdt,
        intraday_setups=[],
    )


def morning_brief_context_from_payload_dict(raw: dict[str, Any], briefing_date: date, pdt: PDTAssessment | None) -> MorningBriefContext:
    """Build context from client/test JSON (no I/O)."""
    econ_raw = raw.get("economic_events") or []
    econ = [
        EconomicEventBrief(
            time=str(x.get("time") or ""),
            event_name=str(x.get("event_name") or ""),
            impact=str(x.get("impact") or "low"),
        )
        for x in econ_raw
        if isinstance(x, dict)
    ]
    earn_raw = raw.get("earnings_today") or []
    earn = [
        EarningsBriefRow(
            symbol=str(x.get("symbol") or ""),
            company=str(x.get("company") or ""),
            time=str(x.get("time") or "TBD"),
            est_eps=float(x["est_eps"]) if x.get("est_eps") is not None else None,
        )
        for x in earn_raw
        if isinstance(x, dict)
    ]
    gap_items = list(raw.get("gap_intelligence_items") or [])
    if gap_items and isinstance(gap_items[0], dict):
        pass
    intra_raw = raw.get("intraday_setups") or []
    intra_list = [x for x in intra_raw if isinstance(x, dict)] if isinstance(intra_raw, list) else []
    return MorningBriefContext(
        briefing_date=briefing_date,
        futures_spy_pct=_f(raw.get("futures_spy_pct")),
        futures_qqq_pct=_f(raw.get("futures_qqq_pct")),
        vix_level=_f(raw.get("vix_level")),
        vix_direction=str(raw.get("vix_direction") or "flat"),
        regime=str(raw.get("regime") or "Neutral"),
        economic_events=econ,
        earnings_today=earn,
        gap_intelligence_items=gap_items,
        pdt=pdt,
        intraday_setups=intra_list,
    )


def _f(v: object) -> float | None:
    if v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x
