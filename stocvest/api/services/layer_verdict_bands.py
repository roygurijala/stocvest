"""Per-layer verdict bands (the bullish/bearish cutoffs a layer's 0–100 score must clear
to leave the neutral dead-band).

Each layer score is a *magnitude* (0–100). The directional read (bullish / bearish /
neutral) only flips off neutral once the score crosses these calibrated cutoffs, which sit
well above/below the 50 midpoint — so a 62 sector or 58 geo can be "positive but neutral".
Emitting the band onto the composite layer row lets the UI shade the neutral zone on the
score bar instead of leaving a >50%-filled bar that reads as a contradiction.

These mirror the thresholds applied inside each analyzer; keep them in sync with the
analyzer constants they reference (single source of truth).
"""

from __future__ import annotations

from stocvest.config.signal_parameters import SignalParameters
from stocvest.signals.geo_analyzer import GEO_BEARISH_THRESHOLD, GEO_BULLISH_THRESHOLD
from stocvest.signals.internals_analyzer import (
    INTERNALS_BEARISH_THRESHOLD,
    INTERNALS_BULLISH_THRESHOLD,
)


def layer_verdict_band(
    layer_id: str, params: SignalParameters, *, mode: str
) -> tuple[float, float] | None:
    """Return ``(bearish_cutoff, bullish_cutoff)`` for ``layer_id`` or ``None`` if unknown.

    ``mode`` selects the Technical layer's threshold set ("swing" → swing-technical params,
    anything else → day-technical params).
    """
    lid = (layer_id or "").strip().lower()
    if lid == "technical":
        p = params.swing_technical if str(mode).strip().lower() == "swing" else params.technical
        return float(p.bearish_threshold), float(p.bullish_threshold)
    if lid == "news":
        return float(params.news.bearish_threshold), float(params.news.bullish_threshold)
    if lid == "macro":
        return float(params.macro.bearish_threshold), float(params.macro.bullish_threshold)
    if lid == "sector":
        return float(params.sector.bearish_threshold), float(params.sector.bullish_threshold)
    if lid == "geopolitical":
        return float(GEO_BEARISH_THRESHOLD), float(GEO_BULLISH_THRESHOLD)
    if lid == "internals":
        return float(INTERNALS_BEARISH_THRESHOLD), float(INTERNALS_BULLISH_THRESHOLD)
    return None
