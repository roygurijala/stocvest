from __future__ import annotations

from stocvest.services.alert_signal_email_gate import (
    SKIP_CONFIRMING,
    SKIP_REGIME,
    SKIP_STRENGTH,
    signal_fired_email_allowed,
)


def test_ledger_qualified_bypasses_confirming() -> None:
    ok, skip = signal_fired_email_allowed(
        signal_strength=72,
        n_confirming=0,
        macro_regime="neutral",
        ledger_qualified=True,
    )
    assert ok is True
    assert skip is None


def test_blocks_strength_below_72() -> None:
    ok, skip = signal_fired_email_allowed(signal_strength=55, n_confirming=3, macro_regime="neutral")
    assert ok is False
    assert skip == SKIP_STRENGTH


def test_blocks_regime_avoid() -> None:
    ok, skip = signal_fired_email_allowed(
        signal_strength=80,
        n_confirming=3,
        macro_regime="avoid",
    )
    assert ok is False
    assert skip == SKIP_REGIME


def test_allows_two_triggers_without_confluence() -> None:
    ok, skip = signal_fired_email_allowed(
        signal_strength=75,
        n_confirming=0,
        macro_regime="risk_on",
        trigger_count=2,
    )
    assert ok is True
    assert skip is None


def test_blocks_single_trigger_and_zero_confirming() -> None:
    ok, skip = signal_fired_email_allowed(
        signal_strength=80,
        n_confirming=0,
        macro_regime="neutral",
        trigger_count=1,
    )
    assert ok is False
    assert skip == SKIP_CONFIRMING
