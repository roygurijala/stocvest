"""
Exclude session % moves caused by splits, reverse splits, and related corporate actions.

Polygon snapshots can compare an unadjusted prior close to a post-split last trade,
producing multi-thousand-percent "gaps" that are accounting artifacts, not real moves.
"""

from __future__ import annotations

from typing import Iterable

# Common US equity split ratios (forward and reverse).
_COMMON_SPLIT_FACTORS: tuple[int, ...] = (
    2,
    3,
    4,
    5,
    6,
    8,
    10,
    12,
    15,
    20,
    25,
    30,
    40,
    50,
    100,
)

# Price ratio tolerance when matching a standard split factor.
_SPLIT_RATIO_TOLERANCE = 0.12

# Sub-$2 prior close with a huge % move is almost always a penny-stock corporate action.
_PENNY_PREV_CLOSE_MAX = 2.0
_PENNY_GAP_PCT_MIN = 50.0

# Hard cap: real single-session moves above this are vanishingly rare for liquid names.
_EXTREME_GAP_PCT = 200.0


def price_ratio_suggests_split(
    prev_close: float,
    session_price: float,
    *,
    tolerance: float = _SPLIT_RATIO_TOLERANCE,
) -> bool:
    """True when price/prev is close to a standard split factor or its inverse."""
    if prev_close <= 0 or session_price <= 0:
        return False
    ratio = session_price / prev_close
    if ratio <= 0:
        return False
    for factor in _COMMON_SPLIT_FACTORS:
        fwd = float(factor)
        rev = 1.0 / fwd
        for target in (fwd, rev):
            if abs(ratio - target) / target <= tolerance:
                return True
    return False


def is_corporate_action_session_move(
    prev_close: float | None,
    session_price: float | None,
    gap_pct: float | None = None,
    *,
    recent_split_symbols: Iterable[str] | None = None,
    symbol: str | None = None,
) -> bool:
    """
    Return True when a session % move should be excluded from movers and session displays.

    ``recent_split_symbols`` comes from Polygon ``/v3/reference/splits`` (last N days).
    """
    if symbol and recent_split_symbols is not None:
        sym = symbol.strip().upper()
        if sym and sym in {s.strip().upper() for s in recent_split_symbols if s}:
            return True

    if prev_close is None or session_price is None:
        return False
    try:
        prev = float(prev_close)
        price = float(session_price)
    except (TypeError, ValueError):
        return False
    if prev <= 0 or price <= 0:
        return False

    pct = gap_pct
    if pct is None:
        pct = (price - prev) / prev * 100.0
    try:
        gap = float(pct)
    except (TypeError, ValueError):
        gap = 0.0

    if price_ratio_suggests_split(prev, price):
        return True

    if prev < _PENNY_PREV_CLOSE_MAX and abs(gap) >= _PENNY_GAP_PCT_MIN:
        return True

    if abs(gap) >= _EXTREME_GAP_PCT:
        ratio = price / prev
        if ratio >= 2.0 or ratio <= 0.5:
            return True

    return False


def sanitize_session_change_pct(
    prev_close: float | None,
    session_price: float | None,
    change_pct: float | None,
    *,
    symbol: str | None = None,
    recent_split_symbols: Iterable[str] | None = None,
) -> float | None:
    """Return ``change_pct`` unless the move is a corporate-action artifact (then ``None``)."""
    if change_pct is None:
        return None
    try:
        pct = float(change_pct)
    except (TypeError, ValueError):
        return None
    if not (pct == pct):  # NaN
        return None
    if is_corporate_action_session_move(
        prev_close,
        session_price,
        pct,
        symbol=symbol,
        recent_split_symbols=recent_split_symbols,
    ):
        return None
    return pct
