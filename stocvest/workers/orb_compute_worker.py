"""Scheduled job: compute session ORB from Polygon 1m bars and store in DynamoDB."""

from __future__ import annotations

import asyncio
from datetime import date, datetime
from zoneinfo import ZoneInfo

from stocvest.api.services.scanner_scheduled_pipeline import _parse_scanner_symbols
from stocvest.data.models import Timeframe
from stocvest.data.orb_store import store_orb_record
from stocvest.data.polygon_client import PolygonClient
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)
_ET = ZoneInfo("America/New_York")


def _bars_in_orb_window(bars, trade_date: date) -> list:
    """Keep 1m bars whose start falls in 9:30–10:00 ET (inclusive) on ``trade_date``."""
    kept = []
    for bar in bars:
        ts = bar.timestamp.astimezone(_ET)
        if ts.date() != trade_date:
            continue
        mins = ts.hour * 60 + ts.minute
        if 9 * 60 + 30 <= mins <= 10 * 60:
            kept.append(bar)
    return kept


def get_scanner_symbols() -> list[str]:
    """Symbols from Lambda env ``STOCVEST_SCANNER_SYMBOLS`` (same as scheduled scanner)."""
    return _parse_scanner_symbols()


async def compute_orb_for_symbols(
    symbols: list[str],
    polygon_client: PolygonClient,
    trade_date: date | None = None,
) -> dict[str, object]:
    td = trade_date or date.today()
    results: dict[str, object] = {}
    day = td.isoformat()

    for symbol in symbols:
        sym = symbol.strip().upper()
        if not sym:
            continue
        try:
            bars = await polygon_client.get_bars(
                sym,
                Timeframe.MIN_1,
                from_date=day,
                to_date=day,
                limit=500,
            )
            window = _bars_in_orb_window(bars, td)
            if not window:
                _LOG.warning("orb_no_bars symbol=%s", sym)
                continue
            orb_high = max(float(b.high) for b in window)
            orb_low = min(float(b.low) for b in window)
            record = store_orb_record(sym, orb_high, orb_low, trade_date=td)
            results[sym] = record
            _LOG.info(
                "orb_computed symbol=%s high=%.4f low=%.4f range_pct=%.2f",
                sym,
                orb_high,
                orb_low,
                record.orb_range_pct,
            )
        except Exception as exc:
            _LOG.warning("orb_compute_failed symbol=%s error=%s", sym, exc)

    return results


def handler(event, context):
    """EventBridge entrypoint (``STOCVEST_LAMBDA_MODULE=orb_compute``)."""
    _ = context
    raw = event if isinstance(event, dict) else {}
    symbols = raw.get("symbols")
    if not isinstance(symbols, list) or not symbols:
        symbols = get_scanner_symbols()
    symbols = [str(s).strip() for s in symbols if str(s).strip()]

    async def _run():
        client = PolygonClient()
        return await compute_orb_for_symbols(symbols, client)

    results = asyncio.run(_run())
    return {
        "statusCode": 200,
        "computed": len(results),
        "symbols": list(results.keys()),
    }
