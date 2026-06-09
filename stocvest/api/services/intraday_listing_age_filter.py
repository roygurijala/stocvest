"""Drop unseasoned symbols from intraday setup scans (aligns with composite MIN_LISTED_DAYS)."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping

from stocvest.data.models import Bar
from stocvest.data.polygon_client import PolygonClient
from stocvest.data.symbol_universe_eligibility import listing_age_exclusion_reason
from stocvest.data.ticker_reference_cache import get_ticker_reference
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


async def filter_bars_by_listing_age(
    client: PolygonClient,
    bars_by_symbol: Mapping[str, list[Bar]],
    *,
    concurrency: int = 8,
) -> dict[str, list[Bar]]:
    """
    Return ``bars_by_symbol`` with symbols removed when listing age fails composite seasoning.

    Best-effort: symbols whose reference fetch fails but are known recent IPO tickers are excluded.
    """
    keys = [str(k).strip().upper() for k in bars_by_symbol if str(k).strip()]
    if not keys:
        return {}

    sem = asyncio.Semaphore(max(1, concurrency))
    allowed: set[str] = set()

    async def one(sym: str) -> None:
        async with sem:
            ref = await get_ticker_reference(client, sym)
        if listing_age_exclusion_reason(sym, ref) is None:
            allowed.add(sym)

    await asyncio.gather(*[one(sym) for sym in keys])
    dropped = [s for s in keys if s not in allowed]
    if dropped:
        _LOG.debug("intraday_listing_age_filtered dropped=%s", ",".join(dropped[:12]))
    return {sym: list(bars_by_symbol[sym]) for sym in keys if sym in allowed}
