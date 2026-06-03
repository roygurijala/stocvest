"""
Live symbol context fetcher for the STOCVEST Assistant.

Fetches market data for a single ticker in parallel so the assistant can answer
factual questions like "why is MRVL up today?" with real data rather than
generic explanations. All fetches are best-effort: a failed sub-call is caught
and logged; the bundle is returned with whatever data arrived.

Data sources:
  - Polygon  → snapshot (price, volume, VWAP), intraday bars (5-min, ~1 session)
  - Polygon  → news articles with descriptions (last 24 h, up to 8)
  - Benzinga → "why is it moving" entry (WIIM channel)
  - Benzinga → analyst ratings (last 30 d)
  - Benzinga → earnings results (last 2 periods)
  - Benzinga → corporate guidance (last 30 d)
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone

from stocvest.data.benzinga_client import (
    BenzingaClient,
    BenzingaEarningsResult,
    BenzingaGuidance,
    BenzingaRating,
    BenzingaWIMEntry,
)
from stocvest.data.models import Bar, NewsArticle, Snapshot, Timeframe
from stocvest.data.polygon_client import PolygonClient
from stocvest.data.symbol_normalize import to_polygon_symbol
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

# Hard timeout for the entire parallel fetch so a slow upstream never stalls
# the assistant response by more than this many seconds.
_FETCH_TIMEOUT_S = 4.0


@dataclass
class AssistantSymbolContext:
    """All live data gathered for a single ticker in one assistant turn."""

    symbol: str
    snapshot: Snapshot | None = None
    news: list[NewsArticle] = field(default_factory=list)
    wim: BenzingaWIMEntry | None = None          # "why is it moving" Benzinga entry
    analyst_ratings: list[BenzingaRating] = field(default_factory=list)
    earnings: list[BenzingaEarningsResult] = field(default_factory=list)
    guidance: list[BenzingaGuidance] = field(default_factory=list)
    bars_5m: list[Bar] = field(default_factory=list)
    fetched_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def has_data(self) -> bool:
        """True when at least snapshot or news were successfully fetched."""
        return self.snapshot is not None or bool(self.news)


async def fetch_assistant_symbol_context(symbol: str) -> AssistantSymbolContext | None:
    """Fetch live context for *symbol* and return an :class:`AssistantSymbolContext`.

    Returns ``None`` when ``symbol`` is blank. Never raises — all sub-call
    failures are caught internally and the bundle is returned with partial data.
    """
    sym = to_polygon_symbol((symbol or "").strip().upper())
    if not sym:
        return None

    ctx = AssistantSymbolContext(symbol=sym)

    async def _snapshot() -> None:
        try:
            async with PolygonClient() as poly:
                ctx.snapshot = await poly.get_snapshot(sym)
        except Exception as exc:  # noqa: BLE001
            _LOG.debug("assistant_ctx.snapshot failed %s: %s", sym, exc)

    async def _news() -> None:
        try:
            async with PolygonClient() as poly:
                ctx.news = await poly.get_news(sym, limit=8, days=1)
        except Exception as exc:  # noqa: BLE001
            _LOG.debug("assistant_ctx.news failed %s: %s", sym, exc)

    async def _benzinga() -> None:
        try:
            bz = BenzingaClient()
            wim, ratings, earnings, guidance = await asyncio.gather(
                _safe(bz.get_why_is_it_moving(sym)),
                _safe(bz.get_analyst_ratings(sym, days=30)),
                _safe(bz.get_earnings_results(sym, periods=2)),
                _safe(bz.get_corporate_guidance(sym, days=30)),
                return_exceptions=False,
            )
            ctx.wim = wim
            ctx.analyst_ratings = ratings or []
            ctx.earnings = earnings or []
            ctx.guidance = guidance or []
        except Exception as exc:  # noqa: BLE001
            _LOG.debug("assistant_ctx.benzinga failed %s: %s", sym, exc)

    async def _bars() -> None:
        try:
            async with PolygonClient() as poly:
                ctx.bars_5m = await poly.get_bars(sym, Timeframe.MIN_5, limit=78)
        except Exception as exc:  # noqa: BLE001
            _LOG.debug("assistant_ctx.bars failed %s: %s", sym, exc)

    try:
        await asyncio.wait_for(
            asyncio.gather(_snapshot(), _news(), _benzinga(), _bars()),
            timeout=_FETCH_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        _LOG.debug("assistant_ctx fetch timed out for %s (partial data returned)", sym)
    except Exception as exc:  # noqa: BLE001
        _LOG.debug("assistant_ctx gather error %s: %s", sym, exc)

    return ctx


async def _safe(coro):
    """Run *coro* and return its result, or None on any exception."""
    try:
        return await coro
    except Exception:  # noqa: BLE001
        return None
