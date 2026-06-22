"""Sector-relative calibration constants for the Technical layer (B72).

The Technical layer measures the *same* buckets for every stock (trend, momentum,
volume, levels) — sector should not change *what* is measured, only the
**calibration constants** inside those buckets. This mirrors the B71 News/Geo
sensitivity pattern: fixed structure, sector-scaled inputs.

Two places sector volatility regime matters for technicals:

* **Relative volume (RVOL):** a 1.5× volume day is unremarkable for a chronically
  high-volume semiconductor name but meaningful for a utility. A flat surge
  threshold over-signals on quiet sectors and under-signals on volatile ones, so
  we scale the surge threshold by sector regime.
* **Overbought persistence:** in high-beta / growth uptrends RSI > 70 can persist
  for weeks (momentum), while in defensives it tends to mean-revert. A flat
  overbought penalty misreads a strong tech uptrend the same as a range-bound
  utility, so we scale the overbought penalty by sector regime.

Design constraints (deliberately conservative):

* **Coarse regimes only** — ``HIGH_BETA / NORMAL / DEFENSIVE`` — no false-precision
  per-sector floats on a static prior.
* **Neutral default** — unknown / unrecognized sectors resolve to ``NORMAL``
  (all multipliers ``1.0``), so behavior is unchanged for anything we cannot
  classify and for callers that do not pass a sector.
* **Nudge, never a gate** — these only scale existing scoring contributions; they
  can never block, force, or flip a verdict on their own.
"""

from __future__ import annotations

from enum import Enum

from stocvest.signals.geo_sector_impact import normalize_sector_for_geo


class SectorVolRegime(str, Enum):
    """Coarse sector volatility regime for technical calibration."""

    HIGH_BETA = "high_beta"
    NORMAL = "normal"
    DEFENSIVE = "defensive"


# Recognized regimes only; everything else (incl. unknown) → NORMAL (neutral).
_HIGH_BETA: frozenset[str] = frozenset(
    {"technology", "semiconductors", "software", "consumer_discretionary", "communication_services"}
)
_DEFENSIVE: frozenset[str] = frozenset(
    {"utilities", "consumer_staples", "staples", "consumer_defensive", "real_estate"}
)

# RVOL surge-threshold multiplier — applied to ``volume_surge_multiplier``.
# High-beta names run chronically hot, so require a bigger relative spike to call
# a surge; defensives surge on less, so lower the bar.
_RVOL_THRESHOLD_MULT: dict[SectorVolRegime, float] = {
    SectorVolRegime.HIGH_BETA: 1.2,
    SectorVolRegime.NORMAL: 1.0,
    SectorVolRegime.DEFENSIVE: 0.85,
}

# Overbought-penalty multiplier — applied to the RSI-overbought penalty.
# High-beta uptrends can stay overbought for weeks (persistence) → penalize less;
# defensives mean-revert from overbought reliably → penalize more.
_OVERBOUGHT_PENALTY_MULT: dict[SectorVolRegime, float] = {
    SectorVolRegime.HIGH_BETA: 0.7,
    SectorVolRegime.NORMAL: 1.0,
    SectorVolRegime.DEFENSIVE: 1.2,
}

# Hard guardrails so config / caller drift can never produce an absurd multiplier.
_MULT_FLOOR = 0.5
_MULT_CEILING = 1.5


def _clamp(value: float) -> float:
    return max(_MULT_FLOOR, min(_MULT_CEILING, float(value)))


def sector_vol_regime(sic_bucket: str | None) -> SectorVolRegime:
    """Resolve the coarse volatility regime for an internal SIC / ETF bucket.

    ``sic_bucket`` is the same value the geo analyzer receives as
    ``sector_bucket``. Unknown / empty buckets resolve to ``NORMAL``.
    """
    key = normalize_sector_for_geo(str(sic_bucket or ""))
    if key in _HIGH_BETA:
        return SectorVolRegime.HIGH_BETA
    if key in _DEFENSIVE:
        return SectorVolRegime.DEFENSIVE
    return SectorVolRegime.NORMAL


def rvol_threshold_multiplier(sic_bucket: str | None) -> float:
    """Factor to scale the RVOL surge threshold by (``>= 1`` = harder to surge)."""
    return _clamp(_RVOL_THRESHOLD_MULT[sector_vol_regime(sic_bucket)])


def overbought_penalty_multiplier(sic_bucket: str | None) -> float:
    """Factor to scale the RSI-overbought penalty by (``< 1`` = softer penalty)."""
    return _clamp(_OVERBOUGHT_PENALTY_MULT[sector_vol_regime(sic_bucket)])


def sector_technical_calibration_payload(sic_bucket: str | None) -> dict[str, object]:
    """Trader-legible technical calibration for the API/UI / telemetry."""
    regime = sector_vol_regime(sic_bucket)
    return {
        "sic_bucket": str(sic_bucket or "default"),
        "regime": regime.value,
        "rvol_threshold_multiplier": round(_clamp(_RVOL_THRESHOLD_MULT[regime]), 4),
        "overbought_penalty_multiplier": round(_clamp(_OVERBOUGHT_PENALTY_MULT[regime]), 4),
    }
