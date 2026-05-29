"""
Symbol universe eligibility — liquidity, market cap, ADR watchlist, corporate actions.

Used before composite scoring, session movers, and desk funnel survivors.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Literal

from stocvest.data.chinese_adr_watchlist import chinese_adr_exclusion_reason
from stocvest.data.models import Snapshot
from stocvest.data.ticker_reference import TickerReference

MIN_MARKET_CAP_USD = 500_000_000.0
MIN_AVG_VOLUME_OR_USD = 500_000.0
MIN_STRICT_ADV_USD = 1_000_000.0
MIN_TRADE_PRICE_SWING = 5.0
MIN_TRADE_PRICE_SESSION = 2.0
MIN_SUB_DOLLAR_FLOOR = 1.0
MIN_LISTED_DAYS = 90


@dataclass(frozen=True)
class UniverseEligibilityContext:
    snapshot: Snapshot | None = None
    reference: TickerReference | None = None
    recent_split_symbols: frozenset[str] | None = None
    frequent_reverse_split_symbols: frozenset[str] | None = None


def _session_price(snapshot: Snapshot) -> float | None:
    last = snapshot.last_trade_price
    if last is not None and float(last) > 0:
        return float(last)
    o = snapshot.day_open
    if o is not None and float(o) > 0:
        return float(o)
    c = snapshot.day_close
    if c is not None and float(c) > 0:
        return float(c)
    return None


def _prev_volume(snapshot: Snapshot) -> float | None:
    pv = snapshot.prev_day_volume
    if pv is None:
        return None
    try:
        val = float(pv)
    except (TypeError, ValueError):
        return None
    return val if val > 0 else None


def _passes_market_cap_or_volume(
    reference: TickerReference | None,
    prev_volume: float | None,
    *,
    strict_without_reference: bool,
) -> str | None:
    cap = reference.market_cap if reference else None
    if cap is not None and cap >= MIN_MARKET_CAP_USD:
        return None
    if prev_volume is not None and prev_volume >= MIN_AVG_VOLUME_OR_USD:
        return None
    if reference is None and strict_without_reference:
        if prev_volume is not None:
            if prev_volume >= MIN_STRICT_ADV_USD:
                return None
            return f"average volume below {int(MIN_STRICT_ADV_USD / 1_000_000)}M shares/day minimum"
        return None
    if cap is not None and cap < MIN_MARKET_CAP_USD:
        return f"market cap below ${int(MIN_MARKET_CAP_USD / 1_000_000)}M minimum"
    if prev_volume is not None and prev_volume < MIN_AVG_VOLUME_OR_USD:
        return f"average volume below {int(MIN_AVG_VOLUME_OR_USD / 1_000)}K shares/day minimum"
    return "market cap and volume below minimums"


def snapshot_universe_exclusion_reason(
    symbol: str,
    snapshot: Snapshot,
    *,
    min_trade_price: float = MIN_TRADE_PRICE_SESSION,
    recent_split_symbols: frozenset[str] | None = None,
    frequent_reverse_split_symbols: frozenset[str] | None = None,
    strict_adv: bool = True,
) -> str | None:
    """Snapshot-only gates (no Polygon reference call) for bulk funnel scans."""
    sym = str(symbol or snapshot.symbol or "").strip().upper()
    if not sym:
        return "invalid symbol"

    adr = chinese_adr_exclusion_reason(sym, None)
    if adr:
        return adr

    if frequent_reverse_split_symbols and sym in frequent_reverse_split_symbols:
        return "multiple reverse splits in the last year"

    price = _session_price(snapshot)
    prev = snapshot.prev_close
    prev_f: float | None
    try:
        prev_f = float(prev) if prev is not None and float(prev) > 0 else None
    except (TypeError, ValueError):
        prev_f = None

    if price is not None and price < MIN_SUB_DOLLAR_FLOOR:
        return "price below $1 minimum"
    if prev_f is not None and prev_f < MIN_SUB_DOLLAR_FLOOR:
        return "prior close below $1 minimum"
    if price is not None and price < min_trade_price:
        return f"price below ${min_trade_price:.0f} minimum"

    if recent_split_symbols and sym in recent_split_symbols:
        return "recent stock split"

    vol = float(snapshot.day_volume or 0.0)
    if vol < MIN_AVG_VOLUME_OR_USD:
        prev_vol = _prev_volume(snapshot)
        if prev_vol is None or prev_vol < MIN_AVG_VOLUME_OR_USD:
            return f"volume below {int(MIN_AVG_VOLUME_OR_USD / 1_000)}K shares/day minimum"

    prev_vol = _prev_volume(snapshot)
    if strict_adv and prev_vol is not None and prev_vol < MIN_STRICT_ADV_USD:
        return f"average volume below {int(MIN_STRICT_ADV_USD / 1_000_000)}M shares/day minimum"

    return None


def universe_exclusion_reason(
    symbol: str,
    ctx: UniverseEligibilityContext,
    *,
    mode: Literal["swing", "day", "funnel"] = "swing",
) -> str | None:
    """
    Full eligibility check when reference data may be available.

    ``funnel`` uses snapshot-only rules (reference applied in post-filter batch).
    """
    sym = str(symbol or "").strip().upper()
    snap = ctx.snapshot

    if mode == "funnel":
        if snap is None:
            return "market snapshot unavailable"
        return snapshot_universe_exclusion_reason(
            sym,
            snap,
            min_trade_price=MIN_TRADE_PRICE_SWING,
            recent_split_symbols=ctx.recent_split_symbols,
            frequent_reverse_split_symbols=ctx.frequent_reverse_split_symbols,
        )

    min_price = MIN_TRADE_PRICE_SWING if mode == "swing" else MIN_TRADE_PRICE_SESSION

    if snap is not None:
        snap_reason = snapshot_universe_exclusion_reason(
            sym,
            snap,
            min_trade_price=min_price,
            recent_split_symbols=ctx.recent_split_symbols,
            frequent_reverse_split_symbols=ctx.frequent_reverse_split_symbols,
            strict_adv=False,
        )
        if snap_reason:
            return snap_reason
    elif snap is None:
        return "market snapshot unavailable"

    ref = ctx.reference
    adr = chinese_adr_exclusion_reason(sym, ref)
    if adr:
        return adr

    if ref is not None and ref.active is False:
        return "ticker not active (suspended or delisted)"

    if ref is not None and ref.listed_days() is not None:
        days = ref.listed_days()
        if days is not None and days < MIN_LISTED_DAYS:
            return f"listed fewer than {MIN_LISTED_DAYS} days on current exchange"

    prev_vol = _prev_volume(snap) if snap else None
    cap_or_vol = _passes_market_cap_or_volume(
        ref,
        prev_vol,
        strict_without_reference=(mode == "swing"),
    )
    if cap_or_vol:
        return cap_or_vol

    return None
