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
from stocvest.data.dashboard_cache import evidence_cache_key, read_dashboard_cache
from stocvest.data.models import Bar, NewsArticle, Snapshot, Timeframe
from stocvest.data.polygon_client import PolygonClient
from stocvest.data.symbol_normalize import to_polygon_symbol
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

# Hard timeout for the entire parallel fetch so a slow upstream never stalls
# the assistant response by more than this many seconds. Kept comfortably under
# the API Gateway limit so the subsequent Claude call still has room; 4s proved
# too tight once a single shared client made partial timeouts the common
# failure mode for live symbol answers.
_FETCH_TIMEOUT_S = 7.0


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
    # STOCVEST's own most-recent six-layer composite read for this symbol, when one
    # is cached (see ``fetch_stocvest_composite_read``). ``None`` means STOCVEST has
    # not evaluated this symbol recently — we never fabricate a verdict.
    stocvest_read: dict | None = None
    fetched_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def has_data(self) -> bool:
        """True when any usable market data was fetched.

        Snapshot or news are the richest signals, but intraday/daily bars alone
        are still enough to talk about price action (and render a chart), so we
        treat them as data too rather than falling back to a generic answer.
        """
        return (
            self.snapshot is not None
            or bool(self.news)
            or bool(self.benzinga_news)
            or bool(self.bars_5m)
            or bool(self.bars_1d)
        )


async def fetch_assistant_symbol_context(symbol: str) -> AssistantSymbolContext | None:
    """Fetch live context for *symbol* and return an :class:`AssistantSymbolContext`.

    Returns ``None`` when ``symbol`` is blank. Never raises — all sub-call
    failures are caught internally and the bundle is returned with partial data.
    """
    sym = to_polygon_symbol((symbol or "").strip().upper())
    if not sym:
        return None

    ctx = AssistantSymbolContext(symbol=sym)

    # All Polygon REST calls share ONE client/session. Opening a separate client
    # per call (snapshot/news/bars/daily) multiplied connection setup cost and
    # was prone to exhausting the fetch budget before snapshot/news returned —
    # which left the assistant with no data and forced the generic
    # "I don't have live data" answer. Each sub-call assigns ctx as soon as it
    # completes, so partial data still survives an overall timeout.
    async def _polygon(poly: PolygonClient) -> None:
        async def _snapshot() -> None:
            try:
                ctx.snapshot = await poly.get_snapshot(sym)
            except Exception as exc:  # noqa: BLE001
                _LOG.warning("assistant_ctx.snapshot failed %s: %s", sym, exc)

        async def _news() -> None:
            try:
                # Keep recency tight (≤2 days) — older headlines rarely explain
                # today's move and just add noise.
                ctx.news = await poly.get_news(sym, limit=8, days=2)
            except Exception as exc:  # noqa: BLE001
                _LOG.warning("assistant_ctx.news failed %s: %s", sym, exc)

        async def _bars() -> None:
            try:
                ctx.bars_5m = await poly.get_bars(sym, Timeframe.MIN_5, limit=78)
            except Exception as exc:  # noqa: BLE001
                _LOG.warning("assistant_ctx.bars failed %s: %s", sym, exc)

        async def _daily_bars() -> None:
            try:
                # ~3 months of daily bars → enough for a 50-day average and
                # recent swing support/resistance.
                ctx.bars_1d = await poly.get_bars(sym, Timeframe.DAY_1, limit=65)
            except Exception as exc:  # noqa: BLE001
                _LOG.warning("assistant_ctx.daily_bars failed %s: %s", sym, exc)

        await asyncio.gather(_snapshot(), _news(), _bars(), _daily_bars())

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
            _LOG.warning("assistant_ctx.benzinga failed %s: %s", sym, exc)

    try:
        # PolygonClient requires the API key explicitly — constructing it bare
        # raised a TypeError that left the assistant with no live data.
        async with PolygonClient(api_key=get_settings().polygon_api_key) as poly:
            await asyncio.wait_for(
                asyncio.gather(_polygon(poly), _benzinga()),
                timeout=_FETCH_TIMEOUT_S,
            )
    except asyncio.TimeoutError:
        _LOG.warning("assistant_ctx fetch timed out for %s (partial data returned)", sym)
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("assistant_ctx gather error %s: %s", sym, exc)

    # Promote articles that are actually ABOUT this ticker above sector roundups
    # and off-ticker pieces (e.g. a "C3 AI earnings" story tagged with AVGO).
    # Stable sort preserves the newest-first order within each relevance tier.
    if ctx.news:
        ctx.news = sorted(ctx.news, key=lambda a: news_relevance_rank(sym, getattr(a, "tickers", None), getattr(a, "title", None)))

    if not ctx.has_data:
        _LOG.warning(
            "assistant_ctx: NO live data for %s (snapshot=%s news=%d benzinga_news=%d) — "
            "assistant will fall back to generic answer",
            sym,
            ctx.snapshot is not None,
            len(ctx.news),
            len(ctx.benzinga_news),
        )

    return ctx


async def _safe(coro):
    """Run *coro* and return its result, or None on any exception."""
    try:
        return await coro
    except Exception:  # noqa: BLE001
        return None


def news_relevance_rank(symbol: str, tickers: object, title: object) -> int:
    """Rank a news article's relevance to *symbol* (lower = more on-target).

    Polygon tags sector/roundup pieces with many tickers, so a "C3 AI earnings"
    story can surface in AVGO's feed. We rank an article's relevance by where the
    symbol sits among its tickers (and whether the company is named in the title)
    so the synthesis leads with coverage that is genuinely about the symbol.
    """
    sym = str(symbol or "").strip().upper()
    title_u = str(title or "").upper()
    tks = [str(t).strip().upper() for t in (tickers or []) if str(t).strip()]
    if sym and sym in title_u:
        return 0
    if not tks:
        return 3
    if tks[0] == sym:
        return 0
    if sym in tks[:2]:
        return 1
    if sym in tks:
        # Present but buried among many tickers → likely a market roundup.
        return 2 if len(tks) <= 5 else 3
    return 4


def fetch_stocvest_composite_read(symbol: str, mode: str) -> dict | None:
    """Return STOCVEST's most-recent cached six-layer read for *symbol*, or ``None``.

    The evidence cache is keyed globally per symbol+mode (not per user), so any
    recent evaluation — from this user opening the Evidence card, the scanner, or
    another user — is reusable here. This lets the assistant answer "what does
    STOCVEST think of AVGO?" with STOCVEST's own verdict rather than only an
    external news synthesis. A full live six-layer recompute is far too slow for
    the chat path, so we deliberately surface only what is already cached and never
    fabricate a verdict when nothing is.

    Returns a compact, JSON-serializable dict (verdict, alignment, per-layer leans,
    regime, short reasoning, freshness) or ``None`` when no usable read is cached.
    """
    sym = str(symbol or "").strip().upper()
    if not sym:
        return None
    try:
        envelope = read_dashboard_cache(evidence_cache_key(sym, mode))
    except Exception as exc:  # noqa: BLE001 — STOCVEST read is best-effort
        _LOG.warning("assistant_ctx.stocvest_read cache read failed %s: %s", sym, exc)
        return None
    if not isinstance(envelope, dict):
        return None
    body = envelope.get("data") if isinstance(envelope.get("data"), dict) else envelope
    if not isinstance(body, dict):
        return None
    # Skip error / insufficient bodies — they carry no usable verdict.
    if body.get("error") or str(body.get("status") or "").strip().lower() == "insufficient_data":
        return None

    verdict = str(body.get("signal_summary") or "").strip().lower()
    if verdict not in ("bullish", "bearish", "neutral"):
        return None

    layers = body.get("layers") if isinstance(body.get("layers"), list) else []
    bullish = bearish = neutral = available = 0
    for row in layers:
        if not isinstance(row, dict):
            continue
        status = str(row.get("status") or "").strip().lower()
        # Only layers that actually contributed a read are counted.
        if status not in ("available", "active", "fresh"):
            continue
        available += 1
        lv = str(row.get("verdict") or "").strip().lower()
        if lv == "bullish":
            bullish += 1
        elif lv == "bearish":
            bearish += 1
        else:
            neutral += 1

    read: dict[str, object] = {
        "verdict": verdict,
        "mode": "day" if str(mode or "").strip().lower() in ("day", "intraday", "real") else "swing",
        "leans": {"bullish": bullish, "bearish": bearish, "neutral": neutral, "available": available},
    }

    align = body.get("alignment")
    if isinstance(align, dict):
        label = str(align.get("label") or align.get("state") or "").strip()
        if label:
            read["alignment_label"] = label
    try:
        if body.get("alignment_ratio") is not None:
            read["alignment_ratio"] = round(float(body["alignment_ratio"]), 2)
    except (TypeError, ValueError):
        pass

    regime = str(body.get("regime") or body.get("market_regime") or "").strip()
    if regime:
        read["regime"] = regime

    narrative = body.get("causal_narrative")
    if isinstance(narrative, str) and narrative.strip():
        read["reasoning"] = narrative.strip()[:400]
    elif isinstance(narrative, dict):
        summary = str(narrative.get("summary") or narrative.get("text") or "").strip()
        if summary:
            read["reasoning"] = summary[:400]

    computed_at = str(envelope.get("computed_at") or "").strip()
    if computed_at:
        read["computed_at"] = computed_at
    src = str(body.get("source") or "").strip().lower()
    read["stale"] = src.startswith("cache")

    return read


# Most intraday points we forward to the client for a sparkline. A 5-min session
# is ~78 bars; we cap defensively so the response payload stays small.
_MAX_CHART_POINTS = 80


def build_symbol_chart(ctx: AssistantSymbolContext | None, desk: str = "swing") -> dict | None:
    """Build a compact, deterministic chart payload from a symbol context.

    Returns a JSON-serializable dict for the assistant response, or ``None`` when
    there isn't enough data to render anything. The series and the headline
    numbers come straight from Polygon snapshot/bars — Claude is never asked to
    invent price data.

    ``desk`` controls only the *expanded* (full) chart's candle interval surfaced
    via ``full_chart_timeframe``: the day desk reads hourly candles, the swing desk
    reads daily. The inline sparkline stays an intraday 5-minute series regardless.

    Shapes
    ------
    intraday: {symbol, kind:"intraday", interval:"5m", points:[{t,c}], last,
               change_pct, direction, prev_close, as_of, full_chart_timeframe}
    quote:    same without a points series (when only a snapshot is available).
    """
    if ctx is None:
        return None

    desk_norm = "day" if str(desk or "").strip().lower() in ("day", "intraday", "real") else "swing"
    full_chart_timeframe = "1hour" if desk_norm == "day" else "1day"

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
        "full_chart_timeframe": full_chart_timeframe,
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
# Support/resistance are only shown when they sit within this band of the current
# price. In a strong trend the nearest *real* structure can be far away; rather
# than surface a window-extreme 40-50% from price (which is not actionable and
# misleads, e.g. a "Support" $158 while the stock trades $300), we omit the level.
_SR_PROXIMITY_PCT = 25.0
# Bars on each side that define a confirmed fractal swing pivot.
_PIVOT_WINDOW = 2
# Recent window whose extreme is always considered a candidate level (captures the
# latest high/low that has not yet been confirmed as a fractal pivot).
_RECENT_WINDOW = 12


def _swing_pivots(bars: list, attr: str, *, is_high: bool) -> list[float]:
    """Return the values of confirmed fractal swing pivots for an OHLC attribute.

    A pivot high is a bar whose ``high`` is >= every neighbor within
    ``_PIVOT_WINDOW`` bars on each side; a pivot low is the symmetric minimum.
    These mark prices where the tape actually turned — far more meaningful as
    support/resistance than the raw min/max of a lookback window.
    """
    vals: list[float] = []
    n = len(bars)
    for i in range(_PIVOT_WINDOW, n - _PIVOT_WINDOW):
        try:
            center = float(getattr(bars[i], attr))
        except (TypeError, ValueError, AttributeError):
            continue
        is_pivot = True
        for j in range(i - _PIVOT_WINDOW, i + _PIVOT_WINDOW + 1):
            if j == i:
                continue
            try:
                other = float(getattr(bars[j], attr))
            except (TypeError, ValueError, AttributeError):
                is_pivot = False
                break
            if (is_high and other > center) or (not is_high and other < center):
                is_pivot = False
                break
        if is_pivot:
            vals.append(center)
    return vals


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

    # Analyst price target — average of recent non-null targets, plus the forecast
    # range (high/low) so a forecast answer can show "current vs forecasted max/min".
    targets = [
        float(r.price_target)
        for r in (ctx.analyst_ratings or [])
        if getattr(r, "price_target", None) is not None and float(r.price_target) > 0
    ]
    if targets:
        avg_t = sum(targets) / len(targets)
        _add("Analyst target", "target", avg_t)
        if len(targets) >= 2:
            hi_t, lo_t = max(targets), min(targets)
            # Only surface the bounds when they sit meaningfully apart from the
            # average — otherwise three near-identical lines just stack illegibly.
            if hi_t > avg_t * 1.01:
                _add("Target high", "target_high", hi_t)
            if lo_t < avg_t * 0.99:
                _add("Target low", "target_low", lo_t)

    # Daily-bar derived levels: 50-day average + swing support/resistance.
    daily = ctx.bars_1d or []
    closes = [float(b.close) for b in daily if getattr(b, "close", None) is not None]
    if len(closes) >= 20:
        window = closes[-_SMA_PERIOD:]
        _add(f"{len(window)}-day avg" if len(window) < _SMA_PERIOD else "50-day avg", "sma50", sum(window) / len(window))

    # Support/resistance: confirmed swing pivots plus the most recent window
    # extreme, filtered to the nearest level on each side that sits WITHIN the
    # proximity band. When nothing qualifies near price (e.g. a parabolic move
    # with no recent base), we deliberately render no level — an honest blank is
    # better than a faraway window-extreme dressed up as "support".
    if last and last > 0 and len(daily) >= (2 * _PIVOT_WINDOW + 1):
        lo_band = last * (1 - _SR_PROXIMITY_PCT / 100.0)
        hi_band = last * (1 + _SR_PROXIMITY_PCT / 100.0)
        recent = daily[-_RECENT_WINDOW:]
        recent_lows = [float(b.low) for b in recent if getattr(b, "low", None) is not None]
        recent_highs = [float(b.high) for b in recent if getattr(b, "high", None) is not None]

        support_candidates = _swing_pivots(daily, "low", is_high=False)
        if recent_lows:
            support_candidates.append(min(recent_lows))
        nearby_support = [v for v in support_candidates if lo_band <= v < last]
        if nearby_support:
            _add("Support", "support", max(nearby_support))

        resistance_candidates = _swing_pivots(daily, "high", is_high=True)
        if recent_highs:
            resistance_candidates.append(max(recent_highs))
        nearby_resistance = [v for v in resistance_candidates if last < v <= hi_band]
        if nearby_resistance:
            _add("Resistance", "resistance", min(nearby_resistance))

    return levels
