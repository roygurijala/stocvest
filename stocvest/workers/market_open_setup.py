"""
Pre-market setup jobs for laggard intelligence (Chunk 3).

EventBridge wiring lands in Chunk 9 (`warm_price_cache` action).
"""

from __future__ import annotations

import asyncio
from typing import Any

from stocvest.data.polygon_client import PolygonClient
from stocvest.data.price_cache import PriceCache
from stocvest.data.sector_peer_registry import get_all_registry_symbols
from stocvest.data.watchlist_store import get_watchlist_store
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_DEFAULT_WATCHLIST_SCAN_LIMIT = 200


def collect_watchlist_symbols_for_price_warm(*, scan_limit: int = _DEFAULT_WATCHLIST_SCAN_LIMIT) -> list[str]:
    """All symbols on platform default watchlists (deduplicated)."""
    out: list[str] = []
    seen: set[str] = set()
    try:
        rows = get_watchlist_store().scan_default_watchlists(max(1, scan_limit))
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("price_cache_watchlist_scan_failed err=%s", type(exc).__name__)
        return out
    for wl in rows:
        for sym in wl.symbols or []:
            su = str(sym).strip().upper()
            if su and su not in seen:
                seen.add(su)
                out.append(su)
    return out


async def warm_price_cache_job(*, concurrency: int = 10) -> dict[str, Any]:
    """
    Warm Redis price metrics for registry + watchlist symbols.

    Never raises.
    """
    registry_syms = get_all_registry_symbols()
    watchlist_syms = collect_watchlist_symbols_for_price_warm()
    all_syms = list(dict.fromkeys([*registry_syms, *watchlist_syms]))
    settings = get_settings()
    try:
        async with PolygonClient(api_key=settings.polygon_api_key) as client:
            result = await PriceCache().warm(all_syms, client, concurrency=concurrency)
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("price_cache_warm_failed err=%s", type(exc).__name__)
        return {
            "job": "warm_price_cache",
            "symbols": len(all_syms),
            "cached": 0,
            "errors": len(all_syms),
            "error": type(exc).__name__,
        }

    _LOG.info(
        "price_cache_warmed symbols=%s cached=%s errors=%s",
        len(all_syms),
        result.get("cached"),
        result.get("errors"),
    )
    return {
        "job": "warm_price_cache",
        "symbols": len(all_syms),
        **result,
    }


def handler(event: Any, context: Any) -> dict[str, Any]:
    """Lambda entry for scheduled price cache warm (Chunk 9)."""
    _ = (event, context)
    body = asyncio.run(warm_price_cache_job())
    return {"statusCode": 200, "body": body}
