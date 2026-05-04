from stocvest.signals.confluence import (
    is_orb_long_pattern,
    is_orb_short_pattern,
    normalize_direction,
)


def test_bull_normalizes_to_bullish() -> None:
    assert normalize_direction("bull") == "bullish"


def test_bear_normalizes_to_bearish() -> None:
    assert normalize_direction("bear") == "bearish"


def test_positive_normalizes_to_bullish() -> None:
    assert normalize_direction("positive") == "bullish"


def test_negative_normalizes_to_bearish() -> None:
    assert normalize_direction("negative") == "bearish"


def test_risk_on_normalizes_to_bullish() -> None:
    assert normalize_direction("risk_on") == "bullish"


def test_sideways_normalizes_to_neutral() -> None:
    assert normalize_direction("sideways") == "neutral"


def test_empty_normalizes_to_neutral() -> None:
    assert normalize_direction("") == "neutral"
    assert normalize_direction(None) == "neutral"


def test_case_insensitive() -> None:
    assert normalize_direction("BULL") == "bullish"
    assert normalize_direction("Positive") == "bullish"


def test_mixed_preserved() -> None:
    assert normalize_direction("mixed") == "mixed"


def test_orb_breakout_long_detected() -> None:
    assert is_orb_long_pattern("orb_breakout_long")
    assert is_orb_long_pattern("orb_long")
    assert is_orb_long_pattern("ORB_BREAKOUT_LONG")


def test_orb_breakout_short_detected() -> None:
    assert is_orb_short_pattern("orb_breakout_short")
    assert is_orb_short_pattern("orb_short")


def test_orb_long_not_confused_with_short() -> None:
    assert not is_orb_long_pattern("orb_breakout_short")
    assert not is_orb_short_pattern("orb_breakout_long")
