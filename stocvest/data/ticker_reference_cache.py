"""Cached Polygon ticker reference lookups."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Sequence
from typing import TYPE_CHECKING, Literal

from stocvest.data.polygon_client import PolygonError
from stocvest.data.symbol_universe_eligibility import UniverseEligibilityContext, universe_exclusion_reason
from stocvest.data.ticker_reference import TickerReference, parse_polygon_ticker_details
from stocvest.utils.logging import get_logger
from stocvest.utils.redis_client import get_sync_redis

if TYPE_CHECKING:
    from stocvest.data.models import Snapshot
    from stocvest.data.polygon_client import PolygonClient

_LOG = get_logger(__name__)

_CACHE_TTL_SEC = 86_400


def _cache_key(symbol: str) -> str:
    return f"stocvest:ticker_ref:v1:{symbol.strip().upper()}"


async def get_ticker_reference(client: PolygonClient, symbol: str) -> TickerReference | None:
    """Fetch reference profile with Redis cache (24h). Returns ``None`` on API miss."""
    sym = str(symbol or "").strip().upper()
    if not sym:
        return None

    r = get_sync_redis()
    if r is not None:
        try:
            raw = r.get(_cache_key(sym))
            if raw:
                parsed = json.loads(str(raw))
                if isinstance(parsed, dict):
                    return parse_polygon_ticker_details(parsed, symbol=sym)
        except Exception:
            pass

    try:
        detail = await client.get_ticker_details(sym)
    except PolygonError as exc:
        _LOG.debug("ticker_reference fetch failed %s: %s", sym, str(exc)[:120])
        return None
    except Exception as exc:  # noqa: BLE001
        _LOG.debug("ticker_reference unexpected %s: %s", sym, str(exc)[:120])
        return None

    ref = parse_polygon_ticker_details(detail if isinstance(detail, dict) else None, symbol=sym)
    if ref is None:
        return None

    if r is not None:
        try:
            payload = {
                "ticker": ref.symbol,
                "active": ref.active,
                "market_cap": ref.market_cap,
                "type": ref.security_type,
                "locale": ref.locale,
                "country_code": ref.country_code,
                "primary_exchange": ref.primary_exchange,
                "list_date": ref.list_date.isoformat() if ref.list_date else None,
                "name": ref.name,
            }
            r.set(_cache_key(sym), json.dumps(payload), ex=_CACHE_TTL_SEC)
        except Exception:
            pass
    return ref


async def filter_symbols_by_reference_eligibility(
    client: PolygonClient,
    symbols: Sequence[str],
    snapshots_by_symbol: dict[str, Snapshot],
    *,
    recent_split_symbols: frozenset[str] | None = None,
    frequent_reverse_split_symbols: frozenset[str] | None = None,
    mode: Literal["swing", "day"] = "swing",
    concurrency: int = 8,
) -> frozenset[str]:
    """
    Return symbols that pass full universe eligibility including Polygon reference.

    Intended for post-funnel survivor lists (bounded N, cached lookups).
    """
    sem = asyncio.Semaphore(max(1, concurrency))
    passed: set[str] = set()

    async def one(sym: str) -> None:
        normalized = str(sym or "").strip().upper()
        if not normalized:
            return
        async with sem:
            ref = await get_ticker_reference(client, normalized)
        snap = snapshots_by_symbol.get(normalized)
        reason = universe_exclusion_reason(
            normalized,
            UniverseEligibilityContext(
                snapshot=snap,
                reference=ref,
                recent_split_symbols=recent_split_symbols,
                frequent_reverse_split_symbols=frequent_reverse_split_symbols,
            ),
            mode=mode,
        )
        if reason is None:
            passed.add(normalized)

    targets = [str(s).strip().upper() for s in symbols if str(s).strip()]
    if not targets:
        return frozenset()
    await asyncio.gather(*[one(sym) for sym in targets])
    return frozenset(passed)
