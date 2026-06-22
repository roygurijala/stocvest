"""Day-mode technical fallback when intraday bars are missing (market closed / thin tape)."""

from __future__ import annotations

from stocvest.config.signal_parameters import SwingTechnicalParameters
from stocvest.data.models import Bar, Snapshot
from stocvest.signals.swing_technical_analyzer import SwingTechnicalAnalyzer, SwingTechnicalLayerResult
from stocvest.signals.technical_analyzer import TechnicalAnalyzer, TechnicalLayerResult

# Reduced composite weight vs live session technical (see composite_score effective_weight).


def prior_session_levels_from_daily_bars(daily_bars: list[Bar]) -> tuple[float | None, float | None]:
    """Return (prior session high, prior session low) from daily bar history.

    Uses the bar immediately before the latest daily bar (typically yesterday when
    today's session bar is present in the fetch window).
    """
    if len(daily_bars) < 2:
        return None, None
    bars = sorted(daily_bars, key=lambda b: b.timestamp)
    prior = bars[-2]
    pdh = float(prior.high) if prior.high and float(prior.high) > 0 else None
    pdl = float(prior.low) if prior.low and float(prior.low) > 0 else None
    return pdh, pdl


def snapshot_with_prior_session_levels(snapshot: Snapshot, daily_bars: list[Bar]) -> Snapshot:
    """Attach PDH/PDL to the snapshot passed into the day technical analyzer."""
    pdh, pdl = prior_session_levels_from_daily_bars(daily_bars)
    if pdh is None and pdl is None:
        return snapshot
    updates: dict[str, float] = {}
    if pdh is not None:
        updates["prev_day_high"] = pdh
    if pdl is not None:
        updates["prev_day_low"] = pdl
    return snapshot.model_copy(update=updates)


AS_OF_CLOSE_COMPOSITE_CONFIDENCE = 0.45

_CLOSE_FALLBACK_PREFIX = (
    "As of last close (daily structure — intraday VWAP/ORB not active until the regular session)."
)


def intraday_technical_needs_close_fallback(tech: TechnicalLayerResult) -> bool:
    if tech.status != "unavailable":
        return False
    err = str(tech.error or "").strip().lower()
    return err in {"insufficient_bars", "no_valid_closes"}


def swing_to_technical_as_of_close(
    swing: SwingTechnicalLayerResult,
    *,
    symbol: str,
) -> TechnicalLayerResult:
    """Map daily swing technical output into the day technical layer shape."""
    sym = symbol.strip().upper()
    chips = ["As of close · daily bars"]
    for c in list(swing.chips or [])[:6]:
        label = str(c).strip()
        if label and label not in chips:
            chips.append(label)

    reasoning = str(swing.reasoning or "").strip()
    if reasoning:
        reasoning = f"{_CLOSE_FALLBACK_PREFIX} {reasoning}"
    else:
        reasoning = (
            f"{_CLOSE_FALLBACK_PREFIX} "
            f"Daily structure score {swing.score}/100 from {swing.bars_analyzed} sessions."
        )

    return TechnicalLayerResult(
        status="as_of_close",
        score=swing.score,
        verdict=str(swing.verdict or "neutral"),
        rsi=swing.daily_rsi,
        ema9=swing.sma50,
        ema20=swing.sma200,
        bars_analyzed=swing.bars_analyzed,
        reasoning=reasoning,
        chips=chips,
        error=None,
        vwap_state=None,
        vwap_state_tooltip="Intraday VWAP unavailable outside the live session.",
        vwap_chip="VWAP n/a (session closed)",
        orb_signal="inside_range",
        orb_qualified=False,
    )


def resolve_day_technical_layer(
    *,
    symbol: str,
    intraday_bars: list[Bar],
    snapshot: Snapshot,
    technical_params,
    swing_params: SwingTechnicalParameters,
    daily_bars: list[Bar],
    adv: float | None = None,
    sic_bucket: str | None = None,
) -> TechnicalLayerResult:
    """
    Prefer live intraday technical; when bars are insufficient, use completed daily history.
    """
    snap = snapshot_with_prior_session_levels(snapshot, daily_bars)
    tech = TechnicalAnalyzer().analyze(
        symbol, intraday_bars, snap, technical_params, adv=adv, sic_bucket=sic_bucket
    )
    if not intraday_technical_needs_close_fallback(tech):
        return tech

    if len(daily_bars) < 60:
        tech.reasoning = (
            "Insufficient intraday bars for live technicals and not enough daily history for a close fallback."
        )
        return tech

    swing = SwingTechnicalAnalyzer().analyze(symbol, daily_bars, snapshot, swing_params, sic_bucket=sic_bucket)
    if swing.status != "available" or swing.score is None:
        tech.reasoning = (
            "Insufficient intraday bars; daily-bar fallback could not produce a structure score."
        )
        return tech

    return swing_to_technical_as_of_close(swing, symbol=symbol)


def composite_confidence_for_technical_status(status: str) -> float:
    s = str(status or "").strip().lower()
    if s == "available":
        return 1.0
    if s == "as_of_close":
        return AS_OF_CLOSE_COMPOSITE_CONFIDENCE
    return 0.0
