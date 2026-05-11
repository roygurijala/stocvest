from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest

from stocvest.api.handlers.signals import public_recent_signals_handler, swing_composite_handler
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
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.evaluate_swing_ledger_entry",
        lambda **kwargs: (True, {}),
    )
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.is_swing_ledger_entry_window_et",
        lambda _dt: True,
    )

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
                    {"layer": "macro", "score": 0.45, "confidence": 0.75},
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


def test_swing_composite_handler_stamps_active_parameter_version_actually_used(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D3 integrity gap: the legacy swing_composite_handler used to score with the
    hardcoded ``DEFAULT_BASE_WEIGHTS`` while stamping ``parameter_version`` from
    :class:`ParameterStore`. This made the recorded ``parameter_version`` a lie.

    This test pins the contract that (a) the handler routes its engine build
    through the same ``SignalParameters`` whose ``.version`` it stamps onto the
    record, and (b) overriding the live parameters via ``ParameterStore`` actually
    changes both the score AND the version stamp end-to-end.
    """
    from dataclasses import replace

    from stocvest.api.services.signal_recorder import get_signal_recorder
    from stocvest.config.parameter_store import ParameterStore
    from stocvest.config.signal_parameters import default_signal_parameters

    monkeypatch.setenv("POLYGON_API_KEY", "k")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()

    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.evaluate_swing_ledger_entry",
        lambda **kwargs: (True, {}),
    )
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.is_swing_ledger_entry_window_et",
        lambda _dt: True,
    )
    ParameterStore.invalidate_cache()

    base = default_signal_parameters()
    tuned_composite = replace(
        base.composite,
        technical_weight=0.60,
        news_weight=0.05,
        macro_weight=0.10,
        sector_weight=0.10,
        geopolitical_weight=0.10,
        internals_weight=0.05,
    )
    tuned_params = replace(base, composite=tuned_composite, version="9.9.9-d3-test")
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.ParameterStore.get_parameters_sync",
        lambda: tuned_params,
    )

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
                    {"layer": "macro", "score": 0.45, "confidence": 0.75},
                ],
            }
        )
    }
    response = swing_composite_handler(event, {})
    assert response["statusCode"] == 200
    history = mem.get_signal_history(days=30, limit=10)
    assert len(history) == 1
    record = history[0]
    assert record.symbol == "AAPL"
    assert record.parameter_version == "9.9.9-d3-test"

    get_settings.cache_clear()
    ParameterStore.invalidate_cache()


def test_swing_composite_handler_responds_differently_under_tuned_parameters(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """End-to-end wire-is-live check: identical payload, two different parameter
    versions, two different composite scores. Proves the legacy handler is no
    longer reading hardcoded ``DEFAULT_BASE_WEIGHTS``.
    """
    from dataclasses import replace

    from stocvest.config.parameter_store import ParameterStore
    from stocvest.config.signal_parameters import default_signal_parameters

    monkeypatch.setenv("POLYGON_API_KEY", "k")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()

    base = default_signal_parameters()

    body = json.dumps(
        {
            "regime": "sideways",
            "symbol": "ZZZ",
            "signals": [
                {"layer": "technical", "score": 1.0, "confidence": 1.0},
                {"layer": "news", "score": -1.0, "confidence": 1.0},
                {"layer": "macro", "score": 0.0, "confidence": 1.0},
            ],
        }
    )
    event = {"body": body}

    ParameterStore.invalidate_cache()
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.ParameterStore.get_parameters_sync",
        lambda: base,
    )
    baseline = json.loads(swing_composite_handler(event, {})["body"])

    tuned_composite = replace(
        base.composite,
        technical_weight=0.70,
        news_weight=0.05,
        macro_weight=0.05,
        sector_weight=0.10,
        geopolitical_weight=0.05,
        internals_weight=0.05,
    )
    tuned_params = replace(base, composite=tuned_composite, version="9.9.9-tuned")
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.ParameterStore.get_parameters_sync",
        lambda: tuned_params,
    )
    tuned = json.loads(swing_composite_handler(event, {})["body"])

    assert baseline["score"] != pytest.approx(tuned["score"])
    assert tuned["score"] > baseline["score"]

    get_settings.cache_clear()
    ParameterStore.invalidate_cache()


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

    class _FakePoly:
        async def get_evaluated_price_after_signal(self, symbol: str, generated_at: datetime, *, horizon: str) -> float:
            _ = symbol
            _ = generated_at
            _ = horizon
            return 102.0

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

    class _FakePoly:
        async def get_evaluated_price_after_signal(self, symbol: str, generated_at: datetime, *, horizon: str) -> float:
            _ = symbol
            _ = generated_at
            _ = horizon
            return 98.0

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


def _landing_mem(monkeypatch: pytest.MonkeyPatch) -> InMemorySignalRecorder:
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)
    return mem


def test_landing_param_returns_resolved_only(monkeypatch: pytest.MonkeyPatch) -> None:
    mem = _landing_mem(monkeypatch)
    now = datetime.now(timezone.utc)
    mem.record_signal(
        SignalRecord(
            signal_id="r1",
            symbol="AAA",
            direction="bullish",
            signal_strength=70,
            pattern="orb_breakout_long",
            layer_scores={"technical": 80.0},
            price_at_signal=100.0,
            generated_at=now - timedelta(hours=1),
            outcome_1h="correct",
            price_1h_after=101.0,
            resolved_1h=True,
        )
    )
    mem.record_signal(
        SignalRecord(
            signal_id="r2",
            symbol="BBB",
            direction="bearish",
            signal_strength=60,
            pattern="p2",
            layer_scores={},
            price_at_signal=50.0,
            generated_at=now,
            outcome_1h=None,
        )
    )
    response = public_recent_signals_handler({"queryStringParameters": {"landing": "true"}}, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert list(body.keys()) == ["items"]
    assert len(body["items"]) == 1
    assert body["items"][0]["symbol"] == "AAA"


def test_landing_param_max_5_results(monkeypatch: pytest.MonkeyPatch) -> None:
    mem = _landing_mem(monkeypatch)
    now = datetime.now(timezone.utc)
    for i in range(7):
        mem.record_signal(
            SignalRecord(
                signal_id=f"x{i}",
                symbol=f"S{i}",
                direction="neutral",
                signal_strength=50,
                pattern="p",
                layer_scores={},
                price_at_signal=10.0,
                generated_at=now - timedelta(minutes=i),
                outcome_1h="neutral",
                price_1h_after=10.0,
                resolved_1h=True,
            )
        )
    response = public_recent_signals_handler({"queryStringParameters": {"landing": "true"}}, {})
    body = json.loads(response["body"])
    assert len(body["items"]) == 5


def test_landing_param_excludes_user_id(monkeypatch: pytest.MonkeyPatch) -> None:
    mem = _landing_mem(monkeypatch)
    now = datetime.now(timezone.utc)
    mem.record_signal(
        SignalRecord(
            signal_id="u1",
            symbol="ZZZ",
            direction="bullish",
            signal_strength=55,
            pattern="p",
            layer_scores={},
            price_at_signal=1.0,
            generated_at=now,
            outcome_1h="correct",
            price_1h_after=1.1,
            resolved_1h=True,
        )
    )
    response = public_recent_signals_handler({"queryStringParameters": {"landing": "true"}}, {})
    body = json.loads(response["body"])
    item = body["items"][0]
    assert "user_id" not in item
    assert "user_id" not in json.dumps(body)


def test_landing_param_excludes_private_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    mem = _landing_mem(monkeypatch)
    now = datetime.now(timezone.utc)
    mem.record_signal(
        SignalRecord(
            signal_id="p1",
            symbol="QQQ",
            direction="neutral",
            signal_strength=40,
            pattern="p",
            layer_scores={},
            price_at_signal=400.0,
            generated_at=now,
            outcome_1h="neutral",
            price_1h_after=400.0,
            resolved_1h=True,
        )
    )
    response = public_recent_signals_handler({"queryStringParameters": {"landing": "true"}}, {})
    body = json.loads(response["body"])
    item = body["items"][0]
    for forbidden in ("user_id", "internal_weights", "prompt_version", "raw_polygon_data", "signal_id"):
        assert forbidden not in item


def test_landing_param_includes_layer_scores(monkeypatch: pytest.MonkeyPatch) -> None:
    mem = _landing_mem(monkeypatch)
    now = datetime.now(timezone.utc)
    mem.record_signal(
        SignalRecord(
            signal_id="ls",
            symbol="M1",
            direction="bullish",
            signal_strength=90,
            pattern="confluence_alert",
            layer_scores={
                "technical": 88.0,
                "news": 77.0,
                "macro": 66.0,
                "sector": 55.0,
                "geopolitical": 44.0,
                "internals": 33.0,
            },
            price_at_signal=100.0,
            generated_at=now,
            outcome_1h="correct",
            price_1h_after=102.0,
            resolved_1h=True,
        )
    )
    response = public_recent_signals_handler({"queryStringParameters": {"landing": "true"}}, {})
    item = json.loads(response["body"])["items"][0]
    ls = item["layer_scores"]
    assert set(ls.keys()) == {
        "technical",
        "news",
        "macro",
        "sector",
        "geopolitical",
        "internals",
    }


def test_landing_param_ai_summary_truncated(monkeypatch: pytest.MonkeyPatch) -> None:
    mem = _landing_mem(monkeypatch)
    now = datetime.now(timezone.utc)
    long_text = "x" * 200
    mem.record_signal(
        SignalRecord(
            signal_id="ai",
            symbol="SUM",
            direction="bullish",
            signal_strength=80,
            pattern="p",
            layer_scores={},
            price_at_signal=10.0,
            generated_at=now,
            outcome_1h="correct",
            price_1h_after=10.5,
            resolved_1h=True,
            ai_summary=long_text,
        )
    )
    response = public_recent_signals_handler({"queryStringParameters": {"landing": "true"}}, {})
    item = json.loads(response["body"])["items"][0]
    summary = item.get("ai_summary")
    assert isinstance(summary, str)
    assert len(summary) <= 120
    assert summary.endswith("...")
