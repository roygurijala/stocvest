"""Unit tests for the entry-zone synthesis & validation module."""

from __future__ import annotations

import pytest

from stocvest.api.services.entry_zone import (
    DEFAULT_MIN_RR_FROM_ZONE_HIGH,
    compute_entry_zone,
    config_for_mode,
    resolve_anchor,
    resolve_entry_zone,
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
    # anchor far below (price extended) -> clamp to last - max_width.
    lo, hi = compute_entry_zone(
        direction="long", last=100.0, anchor=80.0, atr=None, max_width_pct=0.02, min_width_pct=0.005
    )
    assert hi == 100.0
    assert lo == pytest.approx(98.0)  # 100 - 2%


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


def test_validate_keeps_clean_zone_below_target() -> None:
    res = validate_entry_zone(
        low=98.0, high=100.0, stop=94.0, target_1=112.0, direction="long", min_rr_from_zone_high=1.5
    )
    assert res.quality == "clean"
    assert res.high < 112.0
    assert res.worst_case_rr is not None and res.worst_case_rr >= 1.5


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
