"""Tests for sector-relative technical calibration (B72) and its analyzer wiring."""

from __future__ import annotations

import pytest

from stocvest.config.signal_parameters import SwingTechnicalParameters, TechnicalParameters
from stocvest.data.models import Bar, Snapshot
from stocvest.signals.sector_technical_calibration import (
    SectorVolRegime,
    overbought_penalty_multiplier,
    rvol_threshold_multiplier,
    sector_technical_calibration_payload,
    sector_vol_regime,
)
from stocvest.signals.swing_technical_analyzer import SwingTechnicalAnalyzer
from stocvest.signals.technical_analyzer import TechnicalAnalyzer

from tests.signals.conftest import make_bars, make_snapshot
from tests.signals.test_swing_technical_analyzer import make_daily_bars


# ---------------------------------------------------------------------------
# Regime resolution
# ---------------------------------------------------------------------------
@pytest.mark.unit
@pytest.mark.parametrize(
    "sic_bucket,expected",
    [
        ("technology", SectorVolRegime.HIGH_BETA),
        ("semiconductors", SectorVolRegime.HIGH_BETA),
        ("software", SectorVolRegime.HIGH_BETA),
        ("utilities", SectorVolRegime.DEFENSIVE),
        ("consumer_staples", SectorVolRegime.DEFENSIVE),
        ("real_estate", SectorVolRegime.DEFENSIVE),
        ("energy", SectorVolRegime.NORMAL),
        ("financials", SectorVolRegime.NORMAL),
        ("industrials", SectorVolRegime.NORMAL),
        (None, SectorVolRegime.NORMAL),
        ("totally_unknown", SectorVolRegime.NORMAL),
    ],
)
def test_sector_vol_regime_resolution(sic_bucket, expected) -> None:
    assert sector_vol_regime(sic_bucket) == expected


@pytest.mark.unit
def test_multipliers_directionally_correct() -> None:
    # High-beta: harder to surge (>1), softer overbought (<1).
    assert rvol_threshold_multiplier("technology") > 1.0
    assert overbought_penalty_multiplier("technology") < 1.0
    # Defensive: easier to surge (<1), harsher overbought (>1).
    assert rvol_threshold_multiplier("utilities") < 1.0
    assert overbought_penalty_multiplier("utilities") > 1.0
    # Unknown / neutral: exactly 1.0 (unchanged behavior).
    assert rvol_threshold_multiplier(None) == 1.0
    assert overbought_penalty_multiplier(None) == 1.0


@pytest.mark.unit
def test_payload_shape() -> None:
    p = sector_technical_calibration_payload("semiconductors")
    assert p["sic_bucket"] == "semiconductors"
    assert p["regime"] == "high_beta"
    assert p["rvol_threshold_multiplier"] > 1.0
    assert p["overbought_penalty_multiplier"] < 1.0
    neutral = sector_technical_calibration_payload(None)
    assert neutral["regime"] == "normal"
    assert neutral["rvol_threshold_multiplier"] == 1.0
    assert neutral["overbought_penalty_multiplier"] == 1.0


# ---------------------------------------------------------------------------
# Day analyzer — sector-relative RVOL surge threshold
# ---------------------------------------------------------------------------
@pytest.mark.unit
def test_day_rvol_threshold_is_sector_relative() -> None:
    """A borderline RVOL (1.65×) counts as a surge for a defensive name (threshold
    1.5×0.85 = 1.275) and a neutral one (1.5) but NOT a high-beta one
    (1.5×1.2 = 1.8) — the surge bar must be sector-relative, not flat."""
    bars = make_bars(30, base_price=100.0, trend=0.001)
    bars[-1] = bars[-1].model_copy(update={"volume": 165_000.0})
    adv = 100_000.0  # → volume_ratio = 1.65
    snap = make_snapshot(price=bars[-1].close)
    params = TechnicalParameters()

    high_beta = TechnicalAnalyzer().analyze("T", bars, snap, params, adv=adv, sic_bucket="technology")
    defensive = TechnicalAnalyzer().analyze("T", bars, snap, params, adv=adv, sic_bucket="utilities")
    neutral = TechnicalAnalyzer().analyze("T", bars, snap, params, adv=adv)

    assert high_beta.volume_surge is False  # 1.65 < 1.8 → not a surge for high-beta
    assert defensive.volume_surge is True  # 1.65 >= 1.275
    assert neutral.volume_surge is True  # 1.65 >= 1.5


@pytest.mark.unit
def test_day_default_sic_bucket_unchanged() -> None:
    """Passing no sector must be identical to passing an unknown one (neutral)."""
    bars = make_bars(30, trend=0.001)
    snap = make_snapshot(price=bars[-1].close)
    params = TechnicalParameters()
    base = TechnicalAnalyzer().analyze("T", bars, snap, params)
    unknown = TechnicalAnalyzer().analyze("T", bars, snap, params, sic_bucket="mystery")
    assert base.score == unknown.score


# ---------------------------------------------------------------------------
# Swing analyzer — sector-relative overbought persistence
# ---------------------------------------------------------------------------
def _overbought_spike_bars() -> tuple[list[Bar], Snapshot]:
    bars = make_daily_bars(210, trend=0.003)
    spike = bars[-1].close * 1.65
    last = bars[-1]
    bars[-1] = Bar(
        symbol=last.symbol,
        timestamp=last.timestamp,
        timeframe=last.timeframe,
        open=last.open,
        high=spike * 1.02,
        low=last.low,
        close=spike,
        volume=last.volume * 3,
    )
    snap = Snapshot(symbol="TEST", last_trade_price=spike, prev_close=bars[-2].close, change_percent=16.0, change=10.0)
    return bars, snap


@pytest.mark.unit
def test_swing_overbought_penalty_is_sector_relative() -> None:
    """An overbought high-beta name keeps more of its score (persistence) than an
    overbought defensive name (mean-reversion), for the identical price path."""
    bars, snap = _overbought_spike_bars()
    params = SwingTechnicalParameters()
    high_beta = SwingTechnicalAnalyzer().analyze("TEST", bars, snap, params, sic_bucket="technology")
    defensive = SwingTechnicalAnalyzer().analyze("TEST", bars, snap, params, sic_bucket="utilities")
    assert high_beta.score is not None and defensive.score is not None
    assert any("overbought" in ch.lower() for ch in high_beta.chips)
    assert high_beta.score > defensive.score


@pytest.mark.unit
def test_swing_default_sic_bucket_unchanged() -> None:
    bars, snap = _overbought_spike_bars()
    params = SwingTechnicalParameters()
    base = SwingTechnicalAnalyzer().analyze("TEST", bars, snap, params)
    unknown = SwingTechnicalAnalyzer().analyze("TEST", bars, snap, params, sic_bucket="mystery")
    assert base.score == unknown.score
