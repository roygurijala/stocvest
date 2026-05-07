"""VWAP availability states for signal display (session RTH context)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")


class VWAPState(str, Enum):
    PRE_MARKET = "pre_market"
    FORMING = "forming"
    AVAILABLE = "available"
    POST_MARKET = "post_market"


VWAP_STATE_CHIP: dict[VWAPState, str] = {
    VWAPState.PRE_MARKET: "VWAP starts at 9:30 ET",
    VWAPState.FORMING: "VWAP Forming",
    VWAPState.AVAILABLE: "VWAP",
    VWAPState.POST_MARKET: "VWAP (RTH closed)",
}

VWAP_STATE_TOOLTIP: dict[VWAPState, str] = {
    VWAPState.PRE_MARKET: (
        "VWAP resets at 9:30 AM ET each session. "
        "Pre-market prices are not included."
    ),
    VWAPState.FORMING: (
        "VWAP is calculating from early session bars. "
        "Becomes reliable after ~15 minutes of trading."
    ),
    VWAPState.AVAILABLE: (
        "Volume Weighted Average Price — "
        "the average price weighted by volume "
        "since market open. Key intraday anchor."
    ),
    VWAPState.POST_MARKET: (
        "VWAP is a Regular Trading Hours (RTH) "
        "indicator only. Not computed post-market."
    ),
}


def vwap_session_flags_et(ref_et: datetime) -> tuple[bool, bool]:
    """Return ``(is_pre_market, market_open_rth)`` for an instant in ET."""
    et = ref_et.astimezone(_ET)
    wd = et.weekday()
    if wd >= 5:
        return False, False
    mins = et.hour * 60 + et.minute
    open_start = 9 * 60 + 30
    close_mins = 16 * 60
    if mins < open_start:
        return True, False
    if mins > close_mins:
        return False, False
    return False, True


def resolve_vwap_state(
    vwap_value: float | None,
    market_open: bool,
    bars_count: int = 0,
    is_pre_market: bool = False,
) -> VWAPState:
    if is_pre_market:
        return VWAPState.PRE_MARKET
    if not market_open:
        return VWAPState.POST_MARKET
    if vwap_value is None or bars_count < 5:
        return VWAPState.FORMING
    return VWAPState.AVAILABLE


def build_vwap_chip(
    state: VWAPState,
    vwap_value: float | None = None,
    price: float | None = None,
) -> str:
    if state == VWAPState.AVAILABLE and vwap_value is not None and float(vwap_value) > 0:
        base = f"VWAP ${float(vwap_value):.2f}"
        if price is not None and float(vwap_value) > 0:
            if float(price) >= float(vwap_value):
                return f"{base} — Above"
            return f"{base} — Below"
        return base
    return VWAP_STATE_CHIP[state]
