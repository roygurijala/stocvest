"""B77 step-1 — time-of-day-normalized intraday relative volume (participation)."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from stocvest.signals.intraday_rvol import (
    cumulative_volume_fraction,
    session_relative_volume,
)

pytestmark = pytest.mark.unit


def _utc(hh: int, mm: int) -> datetime:
    """ET clock → UTC (June DST = UTC-4); 2026-06-22 is a Monday."""
    return datetime(2026, 6, 22, hh + 4, mm, tzinfo=timezone.utc)


# ── cumulative_volume_fraction ────────────────────────────────────────────────

def test_pre_open_is_none() -> None:
    assert cumulative_volume_fraction(_utc(9, 0)) is None
    assert cumulative_volume_fraction(_utc(9, 29)) is None


def test_after_close_is_full() -> None:
    assert cumulative_volume_fraction(_utc(16, 0)) == 1.0
    assert cumulative_volume_fraction(_utc(18, 30)) == 1.0


def test_anchor_points() -> None:
    assert cumulative_volume_fraction(_utc(12, 0)) == pytest.approx(0.40, abs=1e-6)
    assert cumulative_volume_fraction(_utc(13, 0)) == pytest.approx(0.50, abs=1e-6)
    assert cumulative_volume_fraction(_utc(14, 0)) == pytest.approx(0.62, abs=1e-6)


def test_interpolates_between_anchors() -> None:
    # 12:15 ET is halfway between 12:00 (0.40) and 12:30 (0.45) → ~0.425.
    assert cumulative_volume_fraction(_utc(12, 15)) == pytest.approx(0.425, abs=1e-3)


def test_monotonic_non_decreasing() -> None:
    prev = 0.0
    for hh in range(10, 16):
        f = cumulative_volume_fraction(_utc(hh, 0))
        assert f is not None and f >= prev
        prev = f


# ── session_relative_volume ───────────────────────────────────────────────────

def test_average_pace_is_about_one() -> None:
    # At 13:00 ET a typical day has done 50% of volume. day_volume = 50% of ADV → ~1.0.
    rvol = session_relative_volume(day_volume=500_000, adv=1_000_000, ref=_utc(13, 0))
    assert rvol == pytest.approx(1.0, abs=1e-3)


def test_double_pace_is_about_two() -> None:
    rvol = session_relative_volume(day_volume=1_000_000, adv=1_000_000, ref=_utc(13, 0))
    assert rvol == pytest.approx(2.0, abs=1e-3)


def test_half_pace_is_about_half() -> None:
    rvol = session_relative_volume(day_volume=250_000, adv=1_000_000, ref=_utc(13, 0))
    assert rvol == pytest.approx(0.5, abs=1e-3)


@pytest.mark.parametrize(
    "dv,adv",
    [(None, 1_000_000), (500_000, None), (500_000, 0), (500_000, -5), (-1, 1_000_000)],
)
def test_missing_or_bad_inputs_return_none(dv, adv) -> None:
    assert session_relative_volume(dv, adv, _utc(13, 0)) is None


def test_pre_open_returns_none() -> None:
    assert session_relative_volume(500_000, 1_000_000, _utc(9, 0)) is None


def test_signal_record_round_trips_rvol_fields() -> None:
    from stocvest.api.services.signal_recorder import _item_to_record, _record_to_item
    from stocvest.data.models import SignalRecord

    rec = SignalRecord(
        signal_id="sig-1",
        symbol="AAPL",
        direction="bullish",
        signal_strength=100,
        price_at_signal=100.0,
        generated_at=datetime(2026, 6, 22, 17, 0, tzinfo=timezone.utc),
        mode="day",
        intraday_rvol=1.37,
        market_rvol=0.92,
    )
    item = _record_to_item(rec)
    assert float(item["intraday_rvol"]) == pytest.approx(1.37)
    assert float(item["market_rvol"]) == pytest.approx(0.92)
    back = _item_to_record(item)
    assert back.intraday_rvol == pytest.approx(1.37)
    assert back.market_rvol == pytest.approx(0.92)


def test_signal_record_rvol_optional() -> None:
    from stocvest.api.services.signal_recorder import _item_to_record, _record_to_item
    from stocvest.data.models import SignalRecord

    rec = SignalRecord(
        signal_id="sig-2",
        symbol="MSFT",
        direction="bearish",
        signal_strength=80,
        price_at_signal=50.0,
        generated_at=datetime(2026, 6, 22, 17, 0, tzinfo=timezone.utc),
        mode="day",
    )
    item = _record_to_item(rec)
    assert "intraday_rvol" not in item
    assert "market_rvol" not in item
    back = _item_to_record(item)
    assert back.intraday_rvol is None
    assert back.market_rvol is None
