"""Analyst target level extraction — Benzinga ratings and Perplexity JSON."""

from __future__ import annotations

from datetime import datetime, timezone

from stocvest.api.services.analyst_target_levels import (
    analyst_targets_from_payload,
    analyst_targets_from_ratings,
    parse_perplexity_analyst_targets,
)
from stocvest.data.benzinga_client import BenzingaRating


def _rating(symbol: str, pt: float | None) -> BenzingaRating:
    return BenzingaRating(
        symbol=symbol,
        action="initiates",
        rating="Buy",
        price_target=pt,
        analyst_firm="Test Bank",
        published_at=datetime.now(timezone.utc),
    )


def test_analyst_targets_from_ratings_dedupes() -> None:
    rows = [
        _rating("ABC", 12.5),
        _rating("ABC", 12.5),
        _rating("ABC", 15.0),
        _rating("ABC", None),
        _rating("ABC", -1.0),
    ]
    assert analyst_targets_from_ratings(rows) == [12.5, 15.0]


def test_parse_perplexity_analyst_targets_merges_fields() -> None:
    data = {
        "price_targets": [10.0, 11.0],
        "price_target_avg": 10.5,
        "price_target_high": 11.0,
        "price_target_low": 10.0,
    }
    assert parse_perplexity_analyst_targets(data) == [10.0, 11.0, 10.5]


def test_analyst_targets_from_payload() -> None:
    payload = {"analyst_target_levels": [9.5, 9.5, 12.0, "bad"]}
    assert analyst_targets_from_payload(payload) == [9.5, 12.0]


def test_long_geometry_never_promotes_analyst_pt_to_t2() -> None:
    """B80: analyst levels stay informational — T2 comes from structure / 2R / bump only."""
    from stocvest.api.services.swing_composite_evidence import _long_side_geometry

    bars = [{"low": 2.0, "high": h} for h in [3.0, 4.5, 6.0, 8.0, 9.0, 10.5, 11.4]]
    _, t1, t2, _, prov = _long_side_geometry(
        day_lo=8.0,
        day_hi=11.4,
        vwap=9.0,
        prev_close=8.5,
        last=11.0,
        entry=11.0,
        atr=0.4,
        daily_bars=bars,
    )
    assert t1 == 11.4
    assert t2 != 12.0
    assert prov != "resistance" or t2 is None


# --- B76: swing target geometry v2 (analyst-T2 cap + session-high T1 guard) -------------
# Reproduces the served ATAI swing geometry: entry at the high of day ($5.31) with a
# Perplexity analyst PT of $14 (+163%) that legacy logic promotes to a fantasy T2.

_ATAI_BARS = [{"low": 3.6, "high": h} for h in [4.0, 4.5, 5.0, 5.1, 5.2, 5.25, 5.3]]


def test_long_geometry_v2_off_no_longer_promotes_analyst_pt_when_atr_present() -> None:
    """B80: with ATR present, T2 scan uses zone engine — analyst PTs stay informational only."""
    from stocvest.api.services.swing_composite_evidence import _long_side_geometry

    _, t1, t2, _, prov = _long_side_geometry(
        day_lo=5.05,
        day_hi=5.31,
        vwap=5.15,
        prev_close=5.2,
        last=5.31,
        entry=5.31,
        atr=0.5,
        daily_bars=_ATAI_BARS,
        target_geometry_v2=False,
    )
    assert t1 == 5.31  # degenerate: T1 == entry == session high
    assert t2 != 14.0
    assert prov != "resistance" or t2 is None


def test_long_geometry_v2_never_uses_distant_fantasy_t2() -> None:
    """Flag ON: T2 stays structural / 2R — distant levels are not adopted as resistance T2."""
    from stocvest.api.services.swing_composite_evidence import _long_side_geometry

    stop, t1, t2, _, prov = _long_side_geometry(
        day_lo=5.05,
        day_hi=5.31,
        vwap=5.15,
        prev_close=5.2,
        last=5.31,
        entry=5.31,
        atr=0.5,
        daily_bars=_ATAI_BARS,
        target_geometry_v2=True,
    )
    assert t2 != 14.0
    if t2 is not None:
        assert t2 < 14.0


def test_long_geometry_v2_rebuilds_degenerate_session_high_t1() -> None:
    """Flag ON: a session-high T1 sitting on entry is rebuilt so T1 offers real reward."""
    from stocvest.api.services.swing_composite_evidence import _long_side_geometry

    _, t1, _, _, _ = _long_side_geometry(
        day_lo=5.05,
        day_hi=5.31,
        vwap=5.15,
        prev_close=5.2,
        last=5.31,
        entry=5.31,
        atr=0.5,
        daily_bars=_ATAI_BARS,
        target_geometry_v2=True,
    )
    assert t1 is not None
    assert t1 > 5.31  # T1 must clear entry, not sit on it


def test_long_geometry_v2_keeps_session_high_when_it_offers_reward() -> None:
    """Flag ON but price below HOD: session high still clears entry, so T1 is unchanged."""
    from stocvest.api.services.swing_composite_evidence import _long_side_geometry

    _, t1, _, _, _ = _long_side_geometry(
        day_lo=8.0,
        day_hi=11.4,
        vwap=9.0,
        prev_close=8.5,
        last=9.44,
        entry=9.44,
        daily_bars=[{"low": 2.0, "high": h} for h in [3.0, 4.5, 6.0, 8.0, 9.0, 10.5, 11.4]],
        target_geometry_v2=True,
    )
    assert t1 == 11.4


def test_scan_resistance_extra_proximity_pct_caps_analyst_level() -> None:
    from stocvest.signals.structure_resistance_scanner import scan_nearest_resistance_above

    bars = [{"low": 3.6, "high": h} for h in [4.0, 4.5, 5.0, 5.2, 5.3]]
    # Without a cap the distant analyst level is honored (legacy behavior).
    assert (
        scan_nearest_resistance_above(bars, last=5.31, floor_above=5.31, extra_levels=[14.0])
        == 14.0
    )
    # Cap analyst PTs from structural T2 when ATR is absent (legacy path only).
    assert (
        scan_nearest_resistance_above(
            bars, last=5.31, floor_above=5.31, extra_levels=[14.0], extra_proximity_pct=40.0
        )
        is None
    )
    # A nearer analyst level inside the band still passes.
    assert (
        scan_nearest_resistance_above(
            bars, last=5.31, floor_above=5.31, extra_levels=[6.5], extra_proximity_pct=40.0
        )
        == 6.5
    )
