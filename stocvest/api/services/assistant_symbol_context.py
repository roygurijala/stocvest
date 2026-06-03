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
    BenzingaArticle,
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
    # Broader, channel-tagged Benzinga newsfeed (M&A, policy, sector, general) —
    # complements the structured WIIM/ratings/earnings/guidance sections.
    benzinga_news: list[BenzingaArticle] = field(default_factory=list)
    wim: BenzingaWIMEntry | None = None          # "why is it moving" Benzinga entry
    analyst_ratings: list[BenzingaRating] = field(default_factory=list)
    earnings: list[BenzingaEarningsResult] = field(default_factory=list)
    guidance: list[BenzingaGuidance] = field(default_factory=list)
    bars_5m: list[Bar] = field(default_factory=list)
    # Recent daily bars (~3 months) for SMA50 / support / resistance levels.
    bars_1d: list[Bar] = field(default_factory=list)
    fetched_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def has_data(self) -> bool:
        """True when at least snapshot or news were successfully fetched."""
        return self.snapshot is not None or bool(self.news) or bool(self.benzinga_news)


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
                # Keep recency tight (≤2 days) — older headlines rarely explain
                # today's move and just add noise.
                ctx.news = await poly.get_news(sym, limit=8, days=2)
        except Exception as exc:  # noqa: BLE001
            _LOG.debug("assistant_ctx.news failed %s: %s", sym, exc)

    async def _benzinga() -> None:
        try:
            bz = BenzingaClient()
            wim, ratings, earnings, guidance, news = await asyncio.gather(
                _safe(bz.get_why_is_it_moving(sym)),
                _safe(bz.get_analyst_ratings(sym, days=30)),
                _safe(bz.get_earnings_results(sym, periods=2)),
                _safe(bz.get_corporate_guidance(sym, days=30)),
                # Broader channel-tagged newsfeed (last 48h) for general/M&A/policy
                # coverage beyond the structured catalyst sections.
                _safe(bz.get_news(sym, hours=48, limit=20)),
                return_exceptions=False,
            )
            ctx.wim = wim
            ctx.analyst_ratings = ratings or []
            ctx.earnings = earnings or []
            ctx.guidance = guidance or []
            ctx.benzinga_news = news if isinstance(news, list) else []
        except Exception as exc:  # noqa: BLE001
            _LOG.debug("assistant_ctx.benzinga failed %s: %s", sym, exc)

    async def _bars() -> None:
        try:
            async with PolygonClient() as poly:
                ctx.bars_5m = await poly.get_bars(sym, Timeframe.MIN_5, limit=78)
        except Exception as exc:  # noqa: BLE001
            _LOG.debug("assistant_ctx.bars failed %s: %s", sym, exc)

    async def _daily_bars() -> None:
        try:
            async with PolygonClient() as poly:
                # ~3 months of daily bars → enough for a 50-day average and
                # recent swing support/resistance.
                ctx.bars_1d = await poly.get_bars(sym, Timeframe.DAY_1, limit=65)
        except Exception as exc:  # noqa: BLE001
            _LOG.debug("assistant_ctx.daily_bars failed %s: %s", sym, exc)

    try:
        await asyncio.wait_for(
            asyncio.gather(_snapshot(), _news(), _benzinga(), _bars(), _daily_bars()),
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


# Most intraday points we forward to the client for a sparkline. A 5-min session
# is ~78 bars; we cap defensively so the response payload stays small.
_MAX_CHART_POINTS = 80


def build_symbol_chart(ctx: AssistantSymbolContext | None) -> dict | None:
    """Build a compact, deterministic chart payload from a symbol context.

    Returns a JSON-serializable dict for the assistant response, or ``None`` when
    there isn't enough data to render anything. The series and the headline
    numbers come straight from Polygon snapshot/bars — Claude is never asked to
    invent price data.

    Shapes
    ------
    intraday: {symbol, kind:"intraday", interval:"5m", points:[{t,c}], last,
               change_pct, direction, prev_close, as_of}
    quote:    same without a points series (when only a snapshot is available).
    """
    if ctx is None:
        return None

    bars = ctx.bars_5m or []
    snap = ctx.snapshot

    points: list[dict[str, object]] = []
    for b in bars[-_MAX_CHART_POINTS:]:
        try:
            close = float(b.close)
            ts = b.timestamp
        except (AttributeError, TypeError, ValueError):
            continue
        try:
            t_iso = ts.isoformat()
        except AttributeError:
            continue
        points.append({"t": t_iso, "c": round(close, 4)})

    last: float | None = None
    if snap is not None and snap.day_close is not None:
        last = float(snap.day_close)
    elif points:
        last = float(points[-1]["c"])  # type: ignore[arg-type]

    if last is None and not points:
        return None

    change_pct: float | None = None
    if snap is not None and snap.change_percent is not None:
        change_pct = float(snap.change_percent)
    elif len(points) >= 2:
        first_close = float(points[0]["c"])  # type: ignore[arg-type]
        if first_close:
            change_pct = (float(points[-1]["c"]) - first_close) / first_close * 100.0  # type: ignore[arg-type]

    direction = "flat"
    if change_pct is not None:
        if change_pct > 0.05:
            direction = "up"
        elif change_pct < -0.05:
            direction = "down"

    prev_close = (
        round(float(snap.prev_close), 4)
        if snap is not None and snap.prev_close is not None
        else None
    )

    effective_last = last if last is not None else float(points[-1]["c"]) if points else None  # type: ignore[arg-type]

    base: dict[str, object] = {
        "symbol": ctx.symbol,
        "last": round(last, 4) if last is not None else round(float(points[-1]["c"]), 4),  # type: ignore[arg-type]
        "change_pct": round(change_pct, 2) if change_pct is not None else None,
        "direction": direction,
        "prev_close": prev_close,
        "as_of": ctx.fetched_at.isoformat(),
        "levels": _compute_chart_levels(ctx, effective_last),
    }

    # Need at least two points to draw a meaningful line; otherwise quote-only.
    if len(points) < 2:
        base["kind"] = "quote"
        base["points"] = []
        return base

    base["kind"] = "intraday"
    base["interval"] = "5m"
    base["points"] = points
    return base


# Daily look-back windows for derived levels.
_SMA_PERIOD = 50
_SWING_LOOKBACK = 20


def _compute_chart_levels(ctx: AssistantSymbolContext, last: float | None) -> list[dict[str, object]]:
    """Derive labeled reference levels (VWAP, prev close, analyst target, support,
    resistance, 50-day average) for chart overlays. Each entry:
    {label, value, kind, distance_pct}. ``distance_pct`` is the level's distance
    from ``last`` (positive = level above price). All values are best-effort.
    """
    snap = ctx.snapshot
    levels: list[dict[str, object]] = []

    def _add(label: str, kind: str, value: float | None) -> None:
        if value is None:
            return
        try:
            v = float(value)
        except (TypeError, ValueError):
            return
        if v <= 0:
            return
        entry: dict[str, object] = {"label": label, "kind": kind, "value": round(v, 4)}
        if last:
            entry["distance_pct"] = round((v - last) / last * 100.0, 2)
        levels.append(entry)

    # Intraday VWAP and prior close.
    if snap is not None:
        _add("VWAP", "vwap", snap.day_vwap)
        _add("Prev close", "prev_close", snap.prev_close)

    # Analyst price target — average of recent non-null targets.
    targets = [
        float(r.price_target)
        for r in (ctx.analyst_ratings or [])
        if getattr(r, "price_target", None) is not None
    ]
    if targets:
        _add("Analyst target", "target", sum(targets) / len(targets))

    # Daily-bar derived levels: 50-day average + recent swing support/resistance.
    daily = ctx.bars_1d or []
    closes = [float(b.close) for b in daily if getattr(b, "close", None) is not None]
    if len(closes) >= 20:
        window = closes[-_SMA_PERIOD:]
        _add(f"{len(window)}-day avg" if len(window) < _SMA_PERIOD else "50-day avg", "sma50", sum(window) / len(window))
    swing = daily[-_SWING_LOOKBACK:]
    lows = [float(b.low) for b in swing if getattr(b, "low", None) is not None]
    highs = [float(b.high) for b in swing if getattr(b, "high", None) is not None]
    if lows:
        _add("Support", "support", min(lows))
    if highs:
        _add("Resistance", "resistance", max(highs))

    return levels
