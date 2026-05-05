"""Polygon fetch → score → DynamoDB ``DayTradingSetups`` + alerts + WebSocket fan-out for scheduled scans."""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from typing import Any

from stocvest.api.services.alerts_store import put_scanner_alert
from stocvest.api.services.day_trading_setups_store import SCANNER_SYSTEM_ACCOUNT_ID, get_day_trading_setups_store
from stocvest.api.services.watchlist_scanner_alerts import notify_intraday_setups_for_watchlist_users
from stocvest.api.services.signal_dto import (
    serialize_catalyst,
    serialize_gap_candidate,
    serialize_intraday_setup,
)
from stocvest.api.services.websocket_broadcast import broadcast_scanner_payload
from stocvest.data import PolygonClient, PolygonError
from stocvest.data.scan_symbols import SYSTEM_DEFAULTS
from stocvest.data.watchlist_store import get_watchlist_store
from stocvest.data.models import Bar, Snapshot, Timeframe
from stocvest.signals import (
    DailyBriefingGenerator,
    DailyBriefingInput,
    IntradaySetupScanner,
    NewsCatalystDetector,
    PremarketGapScanner,
)
from stocvest.signals.day_trading_scanner import SymbolLiquidityContext
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def _setup_key(scan_type: str) -> str:
    minute = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    return f"{scan_type}#{minute.isoformat()}"


def _parse_scanner_symbols() -> list[str]:
    raw = get_settings().scanner_symbols
    return [s.strip().upper() for s in raw.split(",") if s.strip()]


def merge_scheduled_scan_symbol_universe(
    configured: list[str], platform: list[str], *, cap: int = 40
) -> list[str]:
    """Dedupe configured symbols, aggregated default-watchlist symbols, and ``SYSTEM_DEFAULTS`` (caps total)."""
    return list(dict.fromkeys([*configured, *platform, *SYSTEM_DEFAULTS]))[:cap]


async def _resolve_scheduled_scan_symbols() -> list[str]:
    """Merge Lambda ``scanner_symbols`` config, platform default-watchlist aggregation, and system defaults."""
    configured = _parse_scanner_symbols()
    platform_syms: list[str] = []
    try:
        wl_store = get_watchlist_store()
        items = await asyncio.to_thread(wl_store.scan_default_watchlists, 100)
        seen: set[str] = set()
        for it in items:
            for s in it.symbols or []:
                su = str(s).strip().upper()
                if not su or su in seen:
                    continue
                seen.add(su)
                platform_syms.append(su)
                if len(platform_syms) >= 30:
                    break
            if len(platform_syms) >= 30:
                break
    except Exception as exc:  # noqa: BLE001 — includes get_watchlist_store failures; never block scheduled scan
        _LOG.warning("scheduled scan: platform watchlist aggregation failed: %s", exc)
    return merge_scheduled_scan_symbol_universe(configured, platform_syms, cap=40)


async def _fetch_snapshots(client: PolygonClient, symbols: list[str]) -> list[Any]:
    if not symbols:
        return []
    batch = await client.get_snapshots(symbols)
    return list(batch.values())


async def _fetch_bars_by_symbol(client: PolygonClient, symbols: list[str]) -> dict[str, list[Bar]]:
    out: dict[str, list[Bar]] = {}
    for sym in symbols:
        bars = await client.get_bars(sym, Timeframe.MIN_1, limit=40)
        out[sym] = bars
    return out


def _liquidity_from_snapshots(snaps: list[Snapshot]) -> dict[str, SymbolLiquidityContext]:
    out: dict[str, SymbolLiquidityContext] = {}
    for s in snaps:
        adv = float(s.prev_day_volume) if s.prev_day_volume is not None else None
        px = s.last_trade_price or s.day_open
        lp = float(px) if px is not None and float(px) > 0 else None
        nm = (s.company_name or "").strip() or None
        out[s.symbol.upper()] = SymbolLiquidityContext(avg_daily_volume=adv, last_price=lp, company_name=nm)
    return out


def qualifying_tickers_from_scheduled_scan_document(document: dict[str, Any], scan_type: str) -> list[str]:
    """Symbols from ranked scanner output (gaps premarket; setups intraday) for downstream composite hooks."""
    data = document.get("data") or {}
    syms: list[str] = []
    if scan_type == "premarket":
        for row in data.get("gaps") or []:
            if isinstance(row, dict):
                s = str(row.get("symbol") or "").strip().upper()
                if s:
                    syms.append(s)
    elif scan_type == "intraday":
        for row in data.get("setups") or []:
            if isinstance(row, dict):
                s = str(row.get("symbol") or "").strip().upper()
                if s:
                    syms.append(s)
    return list(dict.fromkeys(syms))


def _run_portfolio_composite_for_qualifying_tickers(*, document: dict[str, Any], scan_type: str) -> None:
    """Best-effort: system composite + optional model-portfolio auto-log per qualifying ticker."""
    if scan_type not in ("premarket", "intraday"):
        return
    if (document.get("data") or {}).get("error"):
        return
    from stocvest.api.services.portfolio_reversal import run_portfolio_scanner_for_symbol

    for sym in qualifying_tickers_from_scheduled_scan_document(document, scan_type):
        try:
            run_portfolio_scanner_for_symbol(sym)
        except Exception as exc:  # noqa: BLE001 — never fail the scanner run
            _LOG.warning("portfolio composite scanner hook failed symbol=%s err=%s", sym, exc)


async def run_scheduled_scan(scan_type: str, *, run_portfolio_composite: bool = False) -> dict[str, Any]:
    """Run a full scheduled pipeline for ``premarket`` | ``intraday`` | ``eod_summary``."""
    settings = get_settings()
    symbols = await _resolve_scheduled_scan_symbols()
    setup_key = _setup_key(scan_type)
    store = get_day_trading_setups_store()

    document: dict[str, Any] = {
        "scan_type": scan_type,
        "symbols": symbols,
        "run_at": datetime.now(timezone.utc).isoformat(),
        "data": {},
    }

    try:
        async with PolygonClient(api_key=settings.polygon_api_key) as client:
            if scan_type == "premarket":
                snaps = await _fetch_snapshots(client, symbols)
                gaps = PremarketGapScanner(min_abs_gap_percent=2.0, min_day_volume=0.0).scan_snapshots(
                    snaps, limit=8
                )
                document["data"]["gaps"] = [serialize_gap_candidate(c) for c in gaps]
            elif scan_type == "intraday":
                bars_by_symbol = await _fetch_bars_by_symbol(client, symbols)
                snaps = await _fetch_snapshots(client, symbols)
                liq = _liquidity_from_snapshots(snaps)
                setups = IntradaySetupScanner(min_score=0.55).scan(
                    bars_by_symbol, liquidity_by_symbol=liq, limit=8
                )
                document["data"]["setups"] = [serialize_intraday_setup(s) for s in setups]
                if setups:
                    try:
                        await asyncio.wait_for(
                            asyncio.to_thread(notify_intraday_setups_for_watchlist_users, setups),
                            timeout=2.0,
                        )
                    except asyncio.TimeoutError:
                        _LOG.warning("watchlist notify timed out after 2s (intraday)")
                    except Exception:
                        _LOG.exception("watchlist notify failed (intraday)")
            elif scan_type == "eod_summary":
                snaps = await _fetch_snapshots(client, symbols)
                gap_objs = PremarketGapScanner(min_abs_gap_percent=2.0, min_day_volume=0.0).scan_snapshots(
                    snaps, limit=8
                )
                articles = await client.get_news(limit=25)
                catalyst_objs = NewsCatalystDetector(min_score=0.35).detect(articles, limit=8)
                bars_by_symbol = await _fetch_bars_by_symbol(client, symbols)
                liq_eod = _liquidity_from_snapshots(snaps)
                setup_objs = IntradaySetupScanner(min_score=0.55).scan(
                    bars_by_symbol, liquidity_by_symbol=liq_eod, limit=8
                )
                briefing = DailyBriefingGenerator().generate(
                    DailyBriefingInput(
                        briefing_date=date.today(),
                        gap_candidates=tuple(gap_objs),
                        news_catalysts=tuple(catalyst_objs),
                        pdt_assessment=None,
                        market_session_summary="Scheduled EOD scanner run.",
                    )
                )
                document["data"]["gaps"] = [serialize_gap_candidate(c) for c in gap_objs]
                document["data"]["catalysts"] = [serialize_catalyst(c) for c in catalyst_objs]
                document["data"]["setups"] = [serialize_intraday_setup(s) for s in setup_objs]
                if setup_objs:
                    try:
                        await asyncio.wait_for(
                            asyncio.to_thread(notify_intraday_setups_for_watchlist_users, setup_objs),
                            timeout=2.0,
                        )
                    except asyncio.TimeoutError:
                        _LOG.warning("watchlist notify timed out after 2s (eod)")
                    except Exception:
                        _LOG.exception("watchlist notify failed (eod)")
                document["data"]["briefing"] = {
                    "date_iso": briefing.date_iso,
                    "title": briefing.title,
                    "markdown": briefing.markdown,
                }
            else:
                return {"error": "unknown_scan_type", "scan_type": scan_type}
    except PolygonError as exc:
        _LOG.warning("scanner pipeline polygon error scan_type=%s err=%s", scan_type, exc)
        document["data"]["error"] = str(exc)
    except Exception as exc:
        _LOG.exception("scanner pipeline failed scan_type=%s", scan_type)
        document["data"]["error"] = str(exc)

    store.put_scan_run(setup_key=setup_key, scan_type=scan_type, document=document)

    summary = {
        "scan_type": scan_type,
        "symbols": symbols,
        "setup_key": setup_key,
        "account_id": SCANNER_SYSTEM_ACCOUNT_ID,
        "keys": list((document.get("data") or {}).keys()),
    }
    put_scanner_alert(title=f"Scanner {scan_type}", detail=summary)
    broadcast_scanner_payload({"type": "scanner_run", **summary})

    if run_portfolio_composite:
        _run_portfolio_composite_for_qualifying_tickers(document=document, scan_type=scan_type)

    return {
        "invocation": "schedule",
        "source": "eventbridge",
        "scan_type": scan_type,
        "status": "completed",
        "setup_key": setup_key,
        "summary": summary,
    }


def run_scheduled_scan_sync(scan_type: str, *, run_portfolio_composite: bool = False) -> dict[str, Any]:
    return asyncio.run(run_scheduled_scan(scan_type, run_portfolio_composite=run_portfolio_composite))
