"""Unit tests for the entry-zone synthesis & validation module."""

from __future__ import annotations

import pytest

from stocvest.api.services.entry_zone import (
    DEFAULT_MIN_RR_FROM_ZONE_HIGH,
    classify_entry_style,
    compute_entry_distance_atr,
    compute_entry_zone,
    compute_ideal_pullback_band,
    config_for_mode,
    distance_tier_from_atr,
    resolve_anchor,
    resolve_structure_entry_anchor,
    resolve_structure_zone_level,
    resolve_entry_zone,
    score_entry_quality_tier,
    validate_entry_zone,
)


def test_config_for_mode_defaults() -> None:
    day = config_for_mode(None, "day")
    swing = config_for_mode(None, "swing")
    assert day["max_width_pct"] == 0.005
    assert day["preferred_anchor"] == "vwap"
    assert swing["max_width_pct"] == 0.020
    assert swing["preferred_anchor"] == "sma20"
    assert day["min_rr_from_zone_high"] == DEFAULT_MIN_RR_FROM_ZONE_HIGH


def test_config_for_mode_overrides_from_payload() -> None:
    cfg = config_for_mode(
        {"swing": {"max_width_pct": 0.03, "preferred_anchor": "sma50"}, "min_rr_from_zone_high": 2.0},
        "swing",
    )
    assert cfg["max_width_pct"] == 0.03
    assert cfg["preferred_anchor"] == "sma50"
    assert cfg["min_rr_from_zone_high"] == 2.0
    # untouched key keeps default
    assert cfg["min_width_pct"] == 0.005


def test_resolve_anchor_prefers_then_falls_back() -> None:
    # Preferred sma20 missing -> falls to vwap.
    assert resolve_anchor(preferred="sma20", vwap=100.0, prev_close=99.0, sma20=None, sma50=98.0, last=101.0) == 100.0
    # Preferred vwap present.
    assert resolve_anchor(preferred="vwap", vwap=100.0, prev_close=None, sma20=None, sma50=None, last=101.0) == 100.0
    # Nothing -> None.
    assert resolve_anchor(preferred="vwap", vwap=None, prev_close=None, sma20=None, sma50=None, last=None) is None


def test_compute_long_zone_pullback_to_anchor() -> None:
    # anchor within max width below price -> zone low pulls to anchor.
    lo, hi = compute_entry_zone(
        direction="long", last=100.0, anchor=99.0, atr=None, max_width_pct=0.02, min_width_pct=0.005
    )
    assert hi == 100.0
    assert lo == pytest.approx(99.0)


def test_compute_long_zone_extended_falls_back_to_max_width() -> None:
    # anchor far below (price extended) -> clamp to last - max_width (pct rail).
    lo, hi = compute_entry_zone(
        direction="long", last=100.0, anchor=80.0, atr=None, max_width_pct=0.02, min_width_pct=0.005
    )
    assert hi == 100.0
    assert lo == pytest.approx(98.0)  # 100 - 2%


@pytest.mark.unit
def test_compute_long_extended_capped_by_gamma_atr() -> None:
    """Extended pullback: band width capped by max_extension_gamma × ATR."""
    lo, hi = compute_entry_zone(
        direction="long",
        last=105.0,
        anchor=100.0,
        atr=2.0,
        max_width_pct=0.02,
        min_width_pct=0.005,
        max_extension_gamma=1.5,
    )
    assert hi == 105.0
    # min(1.5*2, 2%*105)=3 → lower_cap 102; anchor 100 clamped up to 102.9 (2% rail)
    assert lo == pytest.approx(102.9, abs=0.05)


@pytest.mark.unit
def test_compute_breakout_long_stays_tight_above_anchor() -> None:
    lo, hi = compute_entry_zone(
        direction="long",
        last=105.0,
        anchor=104.0,
        atr=2.0,
        max_width_pct=0.02,
        min_width_pct=0.005,
        breakout_band_atr_k=0.4,
        entry_style="breakout",
    )
    assert lo == pytest.approx(104.0)
    assert hi == pytest.approx(104.8)
    assert hi < 105.0


@pytest.mark.unit
def test_classify_entry_style() -> None:
    assert classify_entry_style(None) == "pullback"
    assert classify_entry_style("orb_breakout_long") == "breakout"
    assert classify_entry_style("vwap_reclaim") == "pullback"
    assert classify_entry_style("pullback_to_sma") == "pullback"


@pytest.mark.unit
def test_distance_tier_and_quality_scoring() -> None:
    assert distance_tier_from_atr(0.3) == "ideal"
    assert distance_tier_from_atr(1.0) == "acceptable"
    assert distance_tier_from_atr(2.0) == "chasing"
    assert (
        score_entry_quality_tier(
            validation_quality="clean",
            distance_tier="ideal",
            worst_case_rr=2.5,
            zone_width_atr_val=0.5,
            min_rr=1.5,
        )
        == "high"
    )
    assert (
        score_entry_quality_tier(
            validation_quality="no_clean_entry",
            distance_tier="ideal",
            worst_case_rr=2.5,
            zone_width_atr_val=0.5,
            min_rr=1.5,
        )
        == "low"
    )


@pytest.mark.unit
def test_ideal_pullback_band_symmetric() -> None:
    band = compute_ideal_pullback_band(anchor=100.0, atr=2.0, structure_band_atr_k=0.4)
    assert band == (pytest.approx(99.2), pytest.approx(100.8))


@pytest.mark.unit
def test_resolve_entry_zone_emits_metrics() -> None:
    cfg = config_for_mode(None, "swing")
    res = resolve_entry_zone(
        direction="long",
        last=101.0,
        stop=94.0,
        target_1=120.0,
        anchor=99.0,
        atr=2.0,
        config=cfg,
        entry_style="pullback",
    )
    assert res is not None
    assert res.entry_distance_atr == pytest.approx(1.0)
    assert res.distance_tier == "acceptable"
    assert res.entry_quality_tier in {"high", "medium", "low"}
    assert res.ideal_pullback_zone is not None
    assert res.ideal_pullback_zone["low"] < res.ideal_pullback_zone["high"]


def test_compute_short_zone_mirrors() -> None:
    lo, hi = compute_entry_zone(
        direction="short", last=100.0, anchor=101.0, atr=None, max_width_pct=0.02, min_width_pct=0.005
    )
    assert lo == 100.0
    assert hi == pytest.approx(101.0)


def test_validate_clamps_high_to_keep_worst_case_rr() -> None:
    # Long: stop 90, T1 130. A wide zone high of 120 would give worst-case
    # rr = (130-120)/(120-90) = 0.33 -> must clamp high down to keep >= 1.5.
    res = validate_entry_zone(
        low=95.0, high=120.0, stop=90.0, target_1=130.0, direction="long", min_rr_from_zone_high=1.5
    )
    assert res.quality in {"clamped", "no_clean_entry"}
    # high_max = (130 + 1.5*90)/2.5 = 106
    assert res.high == pytest.approx(106.0, abs=0.1)
    assert res.worst_case_rr == pytest.approx(1.5, abs=0.05)


def test_validate_flags_no_clean_entry_when_band_collapses() -> None:
    # Stop and T1 so close that no band keeps rr>=1.5 above the entry low.
    res = validate_entry_zone(
        low=99.0, high=100.0, stop=98.0, target_1=100.5, direction="long", min_rr_from_zone_high=1.5
    )
    assert res.quality == "no_clean_entry"
    assert res.low == pytest.approx(99.0)
    assert res.high == pytest.approx(100.0)


@pytest.mark.unit
def test_no_clean_entry_preserves_tight_band_when_clamp_inverts_bounds() -> None:
    """INTC-like: tight 2% band under price; target/stop geometry collapses clamped hi below lo."""
    cfg = config_for_mode(None, "swing")
    cfg["min_rr_from_zone_high"] = 2.0
    last = 131.32
    stop = 115.42
    target = 132.61
    res = resolve_entry_zone(
        direction="long",
        last=last,
        stop=stop,
        target_1=target,
        anchor=122.30,
        atr=3.5,
        config=cfg,
    )
    assert res is not None
    assert res.quality == "no_clean_entry"
    assert res.high == pytest.approx(last, abs=0.01)
    width_pct = (res.high - res.low) / last
    assert width_pct <= cfg["max_width_pct"] + 1e-3
    assert width_pct >= cfg["min_width_pct"] - 1e-3
    assert res.worst_case_rr is not None and res.worst_case_rr < 2.0


def test_validate_keeps_clean_zone_below_target() -> None:
    res = validate_entry_zone(
        low=98.0, high=100.0, stop=94.0, target_1=112.0, direction="long", min_rr_from_zone_high=1.5
    )
    assert res.quality == "clean"
    assert res.high < 112.0
    assert res.worst_case_rr is not None and res.worst_case_rr >= 1.5


@pytest.mark.unit
def test_resolve_structure_entry_anchor_prefers_support_zone_for_long() -> None:
    bars = [{"low": 96.0, "high": 99.0}, {"low": 97.0, "high": 100.0}, {"low": 98.0, "high": 101.0}]
    anchor = resolve_structure_entry_anchor(
        direction="long",
        last=100.0,
        atr=2.0,
        daily_bars=bars,
        trading_mode="swing",
        preferred="sma20",
        vwap=99.5,
        prev_close=98.0,
        sma20=50.0,
        sma50=45.0,
        day_lo=96.0,
        day_hi=101.0,
    )
    assert anchor is not None
    assert anchor < 100.0
    assert anchor >= 96.0


@pytest.mark.unit
def test_resolve_structure_entry_anchor_falls_back_without_atr() -> None:
    assert (
        resolve_structure_entry_anchor(
            direction="long",
            last=100.0,
            atr=None,
            daily_bars=[{"low": 96.0, "high": 99.0}],
            trading_mode="swing",
            preferred="vwap",
            vwap=99.0,
            prev_close=None,
            sma20=None,
            sma50=None,
        )
        == 99.0
    )


def test_resolve_entry_zone_end_to_end_long() -> None:
    cfg = config_for_mode(None, "swing")
    res = resolve_entry_zone(
        direction="long",
        last=100.0,
        stop=94.0,
        target_1=120.0,
        anchor=99.0,
        atr=1.0,
        config=cfg,
    )
    assert res is not None
    assert res.low <= res.high <= 100.0
    assert res.high < 120.0


@pytest.mark.unit
def test_resolve_structure_zone_level_returns_none_without_atr() -> None:
    assert (
        resolve_structure_zone_level(
            direction="long",
            last=100.0,
            atr=None,
            daily_bars=[{"low": 96.0, "high": 99.0}],
            trading_mode="swing",
        )
        is None
    )


@pytest.mark.unit
def test_resolve_structure_zone_level_support_for_long() -> None:
    bars = [{"low": 96.0, "high": 99.0}, {"low": 97.0, "high": 100.0}, {"low": 98.0, "high": 101.0}]
    level = resolve_structure_zone_level(
        direction="long",
        last=100.0,
        atr=2.0,
        daily_bars=bars,
        trading_mode="swing",
        day_lo=96.0,
    )
    assert level is not None
    assert level < 100.0
