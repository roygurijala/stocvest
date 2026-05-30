"""Assemble :class:`MorningBriefContext` from Polygon (and optional test overrides)."""

from __future__ import annotations

import asyncio
from datetime import date
from typing import Any, Protocol

from stocvest.api.services.gap_intelligence_news import collect_news_for_gap_intelligence
from stocvest.data import PolygonClient, PolygonError
from stocvest.data.models import EarningsEvent, Snapshot
from stocvest.data.vix_snapshot import snapshot_has_usable_vix_pulse, vix_level_from_snapshot
from stocvest.data.scan_symbols import get_scan_symbols
from stocvest.data.scanner_universe import LIQUID_SYMBOLS_FALLBACK
from stocvest.data.watchlist_store import get_watchlist_store
from stocvest.signals.day_trading_scanner import dynamic_gap_candidates_from_snapshots_with_stats
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

# Fixed order — do not replace with a single configurable ticker; Polygon coverage varies by symbol.
VIX_SNAPSHOT_FALLBACK_SYMBOLS: tuple[str, ...] = ("I:VIX", "^VIX", "VIX")


class SupportsPolygonSnapshotFetch(Protocol):
    """Minimal surface for :func:`get_vix_snapshot_with_fallback` (``PolygonClient`` satisfies this)."""

    async def get_snapshot(self, symbol: str) -> Snapshot:
        ...


async def _fred_vix_snapshot() -> Snapshot | None:
    """FRED ``VIXCLS`` when Polygon indices/stocks are unavailable (e.g. plan 403)."""
    try:
        from stocvest.data.fred_client import FREDClient

        return await FREDClient().get_vix_snapshot()
    except Exception as exc:
        _LOG.debug("fred_vix_snapshot_failed error=%s", exc)
        return None


async def get_vix_snapshot_with_fallback(client: SupportsPolygonSnapshotFetch) -> Snapshot | None:
    """Return the first VIX snapshot that has a usable level or session %.

    Tries Polygon **indices** snapshot first (``GET /v3/snapshot/indices``), then FRED
    ``VIXCLS`` (daily close), then legacy stocks snapshot per symbol.
    Order within Polygon paths: ``VIX_SNAPSHOT_FALLBACK_SYMBOLS``.
    """
    get_indices = getattr(client, "get_indices_snapshots", None)
    if callable(get_indices):
        try:
            by_sym = await get_indices(list(VIX_SNAPSHOT_FALLBACK_SYMBOLS))
            for vix_sym in VIX_SNAPSHOT_FALLBACK_SYMBOLS:
                hit = by_sym.get(vix_sym)
                if snapshot_has_usable_vix_pulse(hit):
                    return hit
        except PolygonError:
            pass

    fred_snap = await _fred_vix_snapshot()
    if snapshot_has_usable_vix_pulse(fred_snap):
        return fred_snap

    for vix_sym in VIX_SNAPSHOT_FALLBACK_SYMBOLS:
        try:
            vix_snap = await client.get_snapshot(vix_sym)
            if snapshot_has_usable_vix_pulse(vix_snap):
                return vix_snap
        except PolygonError:
            continue
    return None


async def _load_snapshots_for_dynamic_gaps(user_id: str | None = None) -> list[Snapshot]:
    settings = get_settings()
    merged = get_scan_symbols(user_id, get_watchlist_store())
    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        try:
            return await client.get_us_stocks_market_snapshots(include_otc=False)
        except PolygonError as exc:
            msg = str(exc)
            if "Polygon 403" in msg or "Polygon 401" in msg:
                _LOG.warning(
                    "US snapshot aggregate unavailable; using watchlist+default merged universe (%s symbols)",
                    len(merged),
                )
                return await client.get_snapshots_many(merged, chunk_size=50)
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
    *,
    user_id: str | None = None,
) -> MorningBriefContext:
    settings = get_settings()
    merged = get_scan_symbols(user_id, get_watchlist_store())
    symbols_earn = list(dict.fromkeys([*merged, *list(LIQUID_SYMBOLS_FALLBACK)]))[:60]

    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        spy, qqq = await asyncio.gather(
            client.get_snapshot("SPY"),
            client.get_snapshot("QQQ"),
        )
        vix_snap = await get_vix_snapshot_with_fallback(client)

        econ_rows = await client.get_economic_calendar_for_day(briefing_date)
        earn_rows = await client.get_earnings_calendar(
            symbols=symbols_earn,
            from_date=briefing_date,
            to_date=briefing_date,
        )

    snaps = await _load_snapshots_for_dynamic_gaps(user_id)
    gap_scan = dynamic_gap_candidates_from_snapshots_with_stats(
        snaps,
        limit=40,
        min_abs_gap_percent=2.0,
        min_day_volume=500_000.0,
        min_trade_price=5.0,
    )
    gaps = gap_scan.candidates
    sym_need = frozenset(g.symbol for g in gaps)
    sym_map = {s.symbol: s for s in snaps if s.symbol in sym_need}
    gap_symbols = [g.symbol for g in gaps]
    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        news = await collect_news_for_gap_intelligence(
            client,
            gap_symbols,
            global_limit=280,
            per_symbol_limit=5,
            max_symbols=10,
        )
    gap_items = build_gap_intelligence_items(gaps, sym_map, news)

    spy_pct = _pct_from_snapshot(spy)
    qqq_pct = _pct_from_snapshot(qqq)
    vix_level = vix_level_from_snapshot(vix_snap)
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
