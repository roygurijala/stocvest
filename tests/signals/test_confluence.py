"""Tests for multi-signal confluence scoring."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from stocvest.api.handlers.signals import day_setups_handler
from stocvest.signals.confluence import CONFLUENCE_DISCLAIMER, ConfluenceDetector


def _det() -> ConfluenceDetector:
    return ConfluenceDetector()


def test_three_confirming_triggers_alert() -> None:
    d = _det()
    r = d.calculate_confluence(
        symbol="TEST",
        direction="long",
        signal_data={"pattern": "orb_breakout_long", "volume_vs_avg": 2.0, "gap_pct": 2.0},
        snapshot={"last_trade_price": 110.0, "day_vwap": 100.0},
        news_catalyst={"sentiment": "bullish", "headline": "Beat"},
        regime="bullish",
        sector_signal="bullish",
    )
    assert r.n_confirming >= 3
    assert r.confluence_score >= 60
    assert r.is_confluence_alert is True


def test_two_confirming_no_alert() -> None:
    d = _det()
    r = d.calculate_confluence(
        symbol="T",
        direction="long",
        signal_data={"pattern": "flat", "volume_vs_avg": 1.0, "gap_pct": 0},
        snapshot={"last_trade_price": 100.0, "day_vwap": 101.0},
        news_catalyst=None,
        regime="neutral",
        sector_signal="neutral",
    )
    assert r.n_confirming <= 2
    assert r.is_confluence_alert is False


def test_score_below_60_no_alert() -> None:
    d = _det()
    r = d.calculate_confluence(
        symbol="T",
        direction="long",
        signal_data={"pattern": "orb_breakout_long", "volume_vs_avg": 2.0, "gap_pct": 2.0},
        snapshot={"last_trade_price": 90.0, "day_vwap": 100.0},
        news_catalyst={"sentiment": "bearish", "headline": "Bad"},
        regime="bearish",
        sector_signal="bearish",
    )
    assert r.n_confirming >= 3
    assert r.confluence_score < 60
    assert r.is_confluence_alert is False


def test_conflicting_reduces_score() -> None:
    d = _det()
    base_snap = {"last_trade_price": 110.0, "day_vwap": 100.0}
    hi = d.calculate_confluence(
        "S",
        "long",
        {"pattern": "orb_breakout_long", "volume_vs_avg": 2.0, "gap_pct": 2.0},
        base_snap,
        {"sentiment": "bullish", "headline": "x"},
        "bullish",
        "bullish",
    )
    lo = d.calculate_confluence(
        "S",
        "long",
        {"pattern": "orb_breakout_long", "volume_vs_avg": 2.0, "gap_pct": 2.0},
        {"last_trade_price": 90.0, "day_vwap": 100.0},
        {"sentiment": "bullish", "headline": "x"},
        "bullish",
        "bullish",
    )
    assert lo.confluence_score < hi.confluence_score


def test_vwap_conflict_when_long_below_vwap() -> None:
    d = _det()
    r = d.calculate_confluence(
        "S",
        "long",
        {"pattern": "x", "volume_vs_avg": 1.0, "gap_pct": 0},
        {"last_trade_price": 90.0, "day_vwap": 100.0},
        None,
        "neutral",
        "neutral",
    )
    assert any(x["source"] == "vwap_position" for x in r.conflicting_signals)


def test_vwap_confirms_when_long_above_vwap() -> None:
    d = _det()
    r = d.calculate_confluence(
        "S",
        "long",
        {"pattern": "x", "volume_vs_avg": 1.0, "gap_pct": 0},
        {"last_trade_price": 110.0, "day_vwap": 100.0},
        None,
        "neutral",
        "neutral",
    )
    assert any(x["source"] == "vwap_position" for x in r.confirming_signals)


def test_regime_confirms_long_when_bullish() -> None:
    d = _det()
    r = d.calculate_confluence(
        "S",
        "long",
        {"pattern": "x", "volume_vs_avg": 1.0, "gap_pct": 0},
        {"last_trade_price": 100.0, "day_vwap": 100.0},
        None,
        "bullish",
        "neutral",
    )
    assert any(x["source"] == "market_regime" for x in r.confirming_signals)


def test_regime_conflicts_long_when_bearish() -> None:
    d = _det()
    r = d.calculate_confluence(
        "S",
        "long",
        {"pattern": "x", "volume_vs_avg": 1.0, "gap_pct": 0},
        {"last_trade_price": 100.0, "day_vwap": 100.0},
        None,
        "bearish",
        "neutral",
    )
    assert any(x["source"] == "market_regime" for x in r.conflicting_signals)


def test_volume_confirms_above_1_5x() -> None:
    d = _det()
    r = d.calculate_confluence(
        "S",
        "long",
        {"pattern": "x", "volume_vs_avg": 1.8, "gap_pct": 0},
        {"last_trade_price": 100.0, "day_vwap": 100.0},
        None,
        "neutral",
        "neutral",
    )
    assert any(x["source"] == "volume_confirm" for x in r.confirming_signals)


def test_volume_conflicts_below_0_8x() -> None:
    d = _det()
    r = d.calculate_confluence(
        "S",
        "long",
        {"pattern": "x", "volume_vs_avg": 0.5, "gap_pct": 0},
        {"last_trade_price": 100.0, "day_vwap": 100.0},
        None,
        "neutral",
        "neutral",
    )
    assert any(x["source"] == "volume_confirm" for x in r.conflicting_signals)


# ---------------------------------------------------------------------------
# Volume label precision — ratios like 0.42× must not collapse to "0.0x avg"
# ---------------------------------------------------------------------------
#
# Regression guard: a "Weak Volume (0.0x avg)" chip is indistinguishable from a
# literal-zero readout and triggers user doubt. Labels MUST use two-decimal
# precision for legitimate fractional ratios and a clearly-approximate
# "<0.05×" floor for the (0, 0.05) sliver. Multiplication sign (×) must be
# used instead of the ASCII "x".


def test_weak_volume_label_uses_two_decimal_precision() -> None:
    d = _det()
    r = d.calculate_confluence(
        "S",
        "long",
        {"pattern": "x", "volume_vs_avg": 0.42, "gap_pct": 0},
        {"last_trade_price": 100.0, "day_vwap": 100.0},
        None,
        "neutral",
        "neutral",
    )
    weak = next(x for x in r.conflicting_signals if x["source"] == "volume_confirm")
    label = weak["label"]
    assert "Weak Volume" in label
    assert "0.42×" in label, f"Expected two-decimal precision in {label!r}"
    assert "0.0x" not in label and "0.0×" not in label, (
        f"Two-decimal precision required to avoid a misleading near-zero readout: {label!r}"
    )


def test_weak_volume_label_floors_sub_005_to_lt_005x() -> None:
    """Ratios in the (0, 0.05) sliver must render as '<0.05×' so the chip
    communicates very-low-volume without faking literal zero."""
    d = _det()
    r = d.calculate_confluence(
        "S",
        "long",
        {"pattern": "x", "volume_vs_avg": 0.01, "gap_pct": 0},
        {"last_trade_price": 100.0, "day_vwap": 100.0},
        None,
        "neutral",
        "neutral",
    )
    weak = next(x for x in r.conflicting_signals if x["source"] == "volume_confirm")
    label = weak["label"]
    assert "<0.05×" in label, f"Sub-0.05 ratio must floor to '<0.05× avg', got {label!r}"


def test_strong_volume_label_uses_two_decimal_precision_and_times_sign() -> None:
    d = _det()
    r = d.calculate_confluence(
        "S",
        "long",
        {"pattern": "x", "volume_vs_avg": 1.83, "gap_pct": 0},
        {"last_trade_price": 100.0, "day_vwap": 100.0},
        None,
        "neutral",
        "neutral",
    )
    strong = next(x for x in r.confirming_signals if x["source"] == "volume_confirm")
    label = strong["label"]
    assert "Strong Volume" in label
    assert "1.83×" in label, f"Strong Volume must use two-decimal × format, got {label!r}"


def test_volume_label_helper_directly() -> None:
    """Belt-and-suspenders coverage of the helper used by both chip paths."""
    from stocvest.signals.confluence import _format_rel_vol

    assert _format_rel_vol(0.42) == "0.42×"
    assert _format_rel_vol(0.01) == "<0.05×"
    assert _format_rel_vol(0.0) == "0.00×"
    assert _format_rel_vol(-1.0) == "0.00×"
    assert _format_rel_vol(2.0) == "2.00×"


def test_bullish_catalyst_confirms_long() -> None:
    d = _det()
    r = d.calculate_confluence(
        "S",
        "long",
        {"pattern": "x", "volume_vs_avg": 1.0, "gap_pct": 0},
        {"last_trade_price": 100.0, "day_vwap": 100.0},
        {"sentiment": "bullish", "headline": "Good news"},
        "neutral",
        "neutral",
    )
    assert any(x["source"] == "news_catalyst" for x in r.confirming_signals)


def test_gap_up_confirms_long() -> None:
    d = _det()
    r = d.calculate_confluence(
        "S",
        "long",
        {"pattern": "x", "volume_vs_avg": 1.0, "gap_pct": 2.5},
        {"last_trade_price": 100.0, "day_vwap": 100.0},
        None,
        "neutral",
        "neutral",
    )
    assert any(x["source"] == "gap_confirm" for x in r.confirming_signals)


def test_exceptional_tier_requires_5_plus_and_80_plus() -> None:
    d = _det()
    r = d.calculate_confluence(
        "S",
        "long",
        {
            "pattern": "orb_breakout_long",
            "volume_vs_avg": 2.0,
            "gap_pct": 2.0,
            "ema9": 99.0,
            "last_trade_price": 110.0,
        },
        {"last_trade_price": 110.0, "day_vwap": 100.0},
        {"sentiment": "bullish", "headline": "h"},
        "bullish",
        "bullish",
    )
    assert r.n_confirming >= 5
    assert r.confluence_score >= 80
    assert r.tier == "exceptional"


def test_weak_tier_when_below_thresholds() -> None:
    d = _det()
    r = d.calculate_confluence(
        "S",
        "long",
        {"pattern": "x", "volume_vs_avg": 1.0, "gap_pct": 0},
        {},
        None,
        "neutral",
        "neutral",
    )
    assert r.n_confirming <= 2
    assert r.tier == "weak"


def test_disclaimer_always_present() -> None:
    d = _det()
    r = d.calculate_confluence("S", "long", {}, {}, None, "neutral", "neutral")
    assert r.disclaimer == CONFLUENCE_DISCLAIMER


def test_historical_note_for_4_confirming() -> None:
    d = _det()
    r = d.calculate_confluence(
        "S",
        "long",
        {"pattern": "orb_breakout_long", "volume_vs_avg": 2.0, "gap_pct": 0.0},
        {"last_trade_price": 110.0, "day_vwap": 100.0},
        None,
        "bullish",
        "neutral",
    )
    assert r.n_confirming == 4
    assert "solid confluence" in r.historical_note.lower()


def test_safe_defaults_when_snapshot_empty() -> None:
    d = _det()
    r = d.calculate_confluence("S", "long", {"pattern": "x", "volume_vs_avg": 1.0, "gap_pct": 0}, {}, None, "neutral", "neutral")
    assert isinstance(r.confluence_score, int)


def test_confluence_in_intraday_setup_response() -> None:
    et = ZoneInfo("America/New_York")
    start = datetime(2026, 4, 28, 9, 30, tzinfo=et)
    bars = []
    for i in range(15):
        close = 100.0 + ((i % 3) * 0.1)
        bars.append(
            {
                "timestamp": (start + timedelta(minutes=i)).isoformat(),
                "timeframe": "1min",
                "open": close - 0.05,
                "high": close + 0.05,
                "low": close - 0.05,
                "close": close,
                "volume": 350_000.0,
            }
        )
    bars.append(
        {
            "timestamp": (start + timedelta(minutes=15)).isoformat(),
            "timeframe": "1min",
            "open": 100.15,
            "high": 100.25,
            "low": 100.1,
            "close": 100.2,
            "volume": 100_000.0,
        }
    )
    bars.append(
        {
            "timestamp": (start + timedelta(minutes=16)).isoformat(),
            "timeframe": "1min",
            "open": 101.0,
            "high": 102.5,
            "low": 100.9,
            "close": 102.2,
            "volume": 400_000.0,
        }
    )
    event = {
        "body": json.dumps(
            {
                "bars_by_symbol": {"GAP1": bars},
                "limit": 5,
                "min_score": 0.5,
                "liquidity_by_symbol": {
                    "GAP1": {"avg_daily_volume": 8_000_000, "last_price": 100.0, "company_name": "Gap1 Inc"}
                },
                "regime": "bullish",
                "sector_signal": "bullish",
                "snapshots_by_symbol": {
                    "GAP1": {"last_trade_price": 102.2, "day_vwap": 100.5},
                },
                "news_catalysts_by_symbol": {
                    "GAP1": {"sentiment": "bullish", "headline": "Upgrade"},
                },
            }
        )
    }
    response = day_setups_handler(event, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert len(body) >= 1
    row = body[0]
    assert row["symbol"] == "GAP1"
    assert "confluence_score" in row
    assert "is_confluence_alert" in row
    assert "confluence_tier" in row
