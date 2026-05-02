from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from stocvest.api.handlers.signals import swing_composite_handler
from stocvest.api.services.signal_recorder import (
    InMemorySignalRecorder,
    get_signal_recorder,
    outcome_from_prices,
    reset_signal_recorder_for_tests,
)
from stocvest.data.models import SignalRecord


@pytest.fixture(autouse=True)
def _reset_recorder() -> None:
    reset_signal_recorder_for_tests()
    yield
    reset_signal_recorder_for_tests()


def test_outcome_from_prices_neutral_band() -> None:
    assert outcome_from_prices("bullish", 100.0, 100.05) == "neutral"


def test_outcome_from_prices_bullish_correct() -> None:
    assert outcome_from_prices("bullish", 100.0, 101.0) == "correct"


def test_outcome_from_prices_bullish_incorrect() -> None:
    assert outcome_from_prices("bullish", 100.0, 99.0) == "incorrect"


def test_outcome_from_prices_bearish_correct() -> None:
    assert outcome_from_prices("bearish", 100.0, 99.0) == "correct"


def test_signal_recorded_on_composite_generation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POLYGON_API_KEY", "k")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    import json

    event = {
        "body": json.dumps(
            {
                "regime": "bull",
                "symbol": "AAPL",
                "price_at_signal": 200.0,
                "pattern": "swing_composite",
                "signals": [
                    {"layer": "technical", "score": 0.7, "confidence": 0.9},
                    {"layer": "news", "score": 0.5, "confidence": 0.8},
                ],
            }
        )
    }
    response = swing_composite_handler(event, {})
    assert response["statusCode"] == 200
    public = mem.get_public_recent(limit=50)
    assert len(public) == 1
    assert public[0]["symbol"] == "AAPL"
    assert public[0]["pattern"] == "swing_composite"
    assert public[0]["price_at_signal"] == 200.0
    get_settings.cache_clear()


def test_resolve_signals_marks_correct_outcome() -> None:
    rec = InMemorySignalRecorder()
    past = datetime.now(timezone.utc) - timedelta(hours=2)
    sid = rec.record_signal(
        SignalRecord(
            signal_id="s1",
            symbol="AAA",
            direction="bullish",
            signal_strength=80,
            pattern="test",
            layer_scores={"technical": 0.5},
            price_at_signal=100.0,
            generated_at=past,
        )
    )
    assert sid == "s1"

    class _FakeSnap:
        def __init__(self, p: float) -> None:
            self.last_trade_price = p

    class _FakePoly:
        async def get_snapshot(self, symbol: str) -> _FakeSnap:
            _ = symbol
            return _FakeSnap(102.0)

    async def _run() -> int:
        return await rec.resolve_signals(60, _FakePoly(), horizon="1h")

    n = asyncio.run(_run())
    assert n == 1
    rows = rec.get_public_recent(limit=10)
    assert rows[0]["outcome_1h"] == "correct"
    assert rows[0]["resolved_1h"] is True


def test_resolve_signals_marks_incorrect_outcome() -> None:
    rec = InMemorySignalRecorder()
    past = datetime.now(timezone.utc) - timedelta(hours=2)
    rec.record_signal(
        SignalRecord(
            signal_id="s2",
            symbol="BBB",
            direction="bullish",
            signal_strength=50,
            pattern="test",
            layer_scores={},
            price_at_signal=100.0,
            generated_at=past,
        )
    )

    class _FakeSnap:
        def __init__(self, p: float) -> None:
            self.last_trade_price = p

    class _FakePoly:
        async def get_snapshot(self, symbol: str) -> _FakeSnap:
            _ = symbol
            return _FakeSnap(98.0)

    async def _run() -> None:
        await rec.resolve_signals(60, _FakePoly(), horizon="1h")

    asyncio.run(_run())
    rows = rec.get_public_recent(limit=10)
    assert rows[0]["outcome_1h"] == "incorrect"


def test_get_signal_history_filters_by_symbol() -> None:
    rec = InMemorySignalRecorder()
    now = datetime.now(timezone.utc)
    rec.record_signal(
        SignalRecord(
            signal_id="a",
            symbol="AAPL",
            direction="neutral",
            signal_strength=50,
            pattern="p",
            layer_scores={},
            price_at_signal=1.0,
            generated_at=now,
        )
    )
    rec.record_signal(
        SignalRecord(
            signal_id="b",
            symbol="MSFT",
            direction="neutral",
            signal_strength=50,
            pattern="p",
            layer_scores={},
            price_at_signal=2.0,
            generated_at=now,
        )
    )
    rows = rec.get_signal_history(user_id=None, symbol="AAPL", days=30, limit=100)
    assert len(rows) == 1
    assert rows[0].symbol == "AAPL"


def test_get_signal_history_filters_by_days() -> None:
    rec = InMemorySignalRecorder()
    rec.record_signal(
        SignalRecord(
            signal_id="old",
            symbol="X",
            direction="neutral",
            signal_strength=50,
            pattern="p",
            layer_scores={},
            price_at_signal=1.0,
            generated_at=datetime.now(timezone.utc) - timedelta(days=40),
        )
    )
    rows = rec.get_signal_history(user_id=None, symbol=None, days=30, limit=100)
    assert len(rows) == 0


def test_get_signal_recorder_returns_memory_when_no_table(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POLYGON_API_KEY", "k")
    monkeypatch.setenv("STOCVEST_ENV", "development")
    monkeypatch.delenv("DYNAMODB_SIGNAL_HISTORY_TABLE", raising=False)
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()
    r = get_signal_recorder()
    assert isinstance(r, InMemorySignalRecorder)
    get_settings.cache_clear()
