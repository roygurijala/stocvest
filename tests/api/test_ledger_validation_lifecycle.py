"""Validation ledger lifecycle: open position, rule-based close, resolve_signals skip."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from stocvest.api.services.signal_recorder import InMemorySignalRecorder, outcome_from_prices
from stocvest.data.models import SignalRecord


def test_resolve_signals_skips_open_validation_row() -> None:
    rec = InMemorySignalRecorder()
    past = datetime.now(timezone.utc) - timedelta(hours=3)
    rec.record_signal(
        SignalRecord(
            signal_id="open1",
            symbol="ZZZ",
            direction="bullish",
            signal_strength=80,
            pattern="test",
            layer_scores={"technical": 0.5},
            price_at_signal=100.0,
            generated_at=past,
            user_id="u-open",
            ledger_qualified=True,
            ledger_position_open=True,
        )
    )

    class _FakePoly:
        async def get_evaluated_price_after_signal(self, symbol: str, generated_at: datetime, *, horizon: str) -> float:
            return 110.0

    n = asyncio.run(rec.resolve_signals(60, _FakePoly(), horizon="1h"))
    assert n == 0
    raw = rec._items["open1"]
    assert not raw.get("resolved_1h")


def test_close_validation_position_day() -> None:
    rec = InMemorySignalRecorder()
    gen = datetime.now(timezone.utc) - timedelta(minutes=30)
    rec.record_signal(
        SignalRecord(
            signal_id="c1",
            symbol="AAA",
            direction="bullish",
            signal_strength=80,
            pattern="test",
            layer_scores={},
            price_at_signal=100.0,
            generated_at=gen,
            user_id="u1",
            ledger_qualified=True,
            ledger_position_open=True,
            mode="day",
        )
    )
    now = datetime.now(timezone.utc)
    ok = rec.close_validation_position(
        signal_id="c1",
        exit_price=105.0,
        exit_rule="day_test",
        exit_reason="unit test",
        mode="day",
        now=now,
    )
    assert ok
    got = rec.get_signal_record_raw("c1")
    assert got is not None
    assert got.closed_at is not None
    assert got.ledger_position_open is False
    assert got.validation_outcome == "favorable"
    assert got.outcome_1h == outcome_from_prices("bullish", 100.0, 105.0)
    assert got.exit_rule == "day_test"


def test_has_open_validation_position() -> None:
    rec = InMemorySignalRecorder()
    rec.record_signal(
        SignalRecord(
            signal_id="o1",
            symbol="IBM",
            direction="bullish",
            signal_strength=50,
            pattern="p",
            layer_scores={},
            price_at_signal=1.0,
            generated_at=datetime.now(timezone.utc),
            user_id="ux",
            ledger_qualified=True,
            ledger_position_open=True,
            mode="swing",
        )
    )
    assert rec.has_open_validation_position("ux", "IBM", "swing") is True
    assert rec.has_open_validation_position("ux", "IBM", "day") is False
