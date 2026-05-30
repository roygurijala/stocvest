from __future__ import annotations

from stocvest.services.alert_email_present import format_alert_pattern, format_direction


def test_format_alert_pattern_joins_day_triggers() -> None:
    raw = "vwap_reclaim ema9_bounce hod_breakout"
    out = format_alert_pattern(raw)
    assert "VWAP Reclaim" in out
    assert "EMA9 Bounce" in out
    assert "Session high expansion" in out
    assert "vwap_reclaim" not in out


def test_format_direction() -> None:
    assert format_direction("long") == "Long"
    assert format_direction("SHORT") == "Short"
