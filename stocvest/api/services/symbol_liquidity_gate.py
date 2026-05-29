"""Minimum liquidity gates before composite / signal evaluation."""

from __future__ import annotations

from stocvest.data.models import Snapshot
from stocvest.data.symbol_universe_eligibility import (
    UniverseEligibilityContext,
    universe_exclusion_reason,
)

# Re-export thresholds for callers that import from this module.
MIN_SWING_PREV_DAY_VOLUME = 1_000_000.0
MIN_SWING_TRADE_PRICE = 5.0
MIN_SWING_SESSION_VOLUME_FALLBACK = 500_000.0


def swing_liquidity_gate_reason(snapshot: Snapshot | None) -> str | None:
    """
    Return a short reason when ``snapshot`` fails swing universe minimums; else ``None``.

    Delegates to :func:`universe_exclusion_reason` (snapshot gates; no reference fetch).
    """
    if snapshot is None:
        return "market snapshot unavailable"
    return universe_exclusion_reason(
        snapshot.symbol,
        UniverseEligibilityContext(snapshot=snapshot),
        mode="swing",
    )
