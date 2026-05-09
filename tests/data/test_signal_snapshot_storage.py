from __future__ import annotations

import json
from dataclasses import replace
from datetime import datetime, timezone

import pytest

from stocvest.api.handlers.signals import signals_analysis_handler, swing_composite_handler
from stocvest.api.services.signal_analysis import build_signal_analysis_payload
from stocvest.api.services.signal_recorder import InMemorySignalRecorder, reset_signal_recorder_for_tests
from stocvest.config.signal_parameters import default_signal_parameters
from stocvest.data.models import SignalRecord
from stocvest.data.signal_snapshots import TechnicalSnapshot


def test_technical_snapshot_stored_with_signal() -> None:
    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    tech = TechnicalSnapshot(
        rsi=65.0,
        vwap=100.0,
        ema9=99.0,
        orb_signal="long_break",
        volume_ratio=1.6,
        price_vs_vwap="above",
        bars_analyzed=50,
    )
    rec = SignalRecord(
        signal_id="s1",
        symbol="AAPL",
        direction="bullish",
        signal_strength=70,
        pattern="swing_composite",
        layer_scores={"technical": 0.5, "news": 0.2, "macro": 0.1},
        price_at_signal=100.0,
        generated_at=datetime.now(timezone.utc),
        outcome_1h="correct",
        technical_snapshot_json=tech.model_dump_json(),
        parameter_version="9.9.9",
    )
    mem.record_signal(rec)
    raw = mem.scan_all_records()[0]
    assert raw.technical_snapshot_json
    loaded = TechnicalSnapshot.model_validate_json(raw.technical_snapshot_json or "{}")
    assert loaded.rsi == 65.0
    assert loaded.orb_signal == "long_break"


def test_parameter_version_stored_with_signal(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_signal_recorder_for_tests()
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
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.ParameterStore.get_parameters_sync",
        lambda: replace(default_signal_parameters(), version="1.0.0"),
    )
    event = {
        "body": json.dumps(
            {
                "regime": "bull",
                "symbol": "AAPL",
                "price_at_signal": 180.0,
                "symbol_snapshot": {"last_trade_price": 180.0, "day_vwap": 179.0},
                "signals": [
                    {"layer": "technical", "score": 0.7, "confidence": 0.9},
                    {"layer": "news", "score": 0.5, "confidence": 0.8},
                    {"layer": "macro", "score": 0.4, "confidence": 0.7},
                ],
            }
        )
    }
    swing_composite_handler(event, {})
    rows = mem.scan_all_records()
    assert len(rows) == 1
    assert rows[0].parameter_version == "1.0.0"


def test_analysis_endpoint_groups_by_rsi(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    for i, rsi in enumerate((62.0, 65.0, 72.0, 55.0, 58.0)):
        t = TechnicalSnapshot(rsi=rsi, price_vs_vwap="above")
        rec = SignalRecord(
            signal_id=f"id{i}",
            symbol="X",
            direction="bullish",
            signal_strength=60,
            pattern="swing_composite",
            layer_scores={"technical": 0.3},
            price_at_signal=100.0,
            generated_at=datetime.now(timezone.utc),
            outcome_1h="correct" if i % 2 == 0 else "incorrect",
            price_1h_after=101.0 if i % 2 == 0 else 99.0,
            technical_snapshot_json=t.model_dump_json(),
        )
        mem.record_signal(rec)
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)
    monkeypatch.setenv("STOCVEST_INTERNAL_ANALYSIS_KEY", "secret-test-key")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()
    try:
        event = {
            "headers": {"X-Stocvest-Internal-Analysis": "secret-test-key"},
            "queryStringParameters": {"period": "30d"},
        }
        resp = signals_analysis_handler(event, {})
        assert resp["statusCode"] == 200
        body = json.loads(resp["body"])
        buckets = {row["bucket"]: row["count"] for row in body["by_rsi_bucket"] if row["bucket"] != "unknown"}
        assert sum(buckets.values()) == 5
    finally:
        monkeypatch.delenv("STOCVEST_INTERNAL_ANALYSIS_KEY", raising=False)
        get_settings.cache_clear()


def test_analysis_shows_layer_accuracy() -> None:
    recs = [
        SignalRecord(
            signal_id="a",
            symbol="S",
            direction="bullish",
            signal_strength=50,
            layer_scores={"technical": 0.8},
            price_at_signal=100.0,
            generated_at=datetime.now(timezone.utc),
            outcome_1h="correct",
            price_1h_after=102.0,
        ),
        SignalRecord(
            signal_id="b",
            symbol="S",
            direction="bullish",
            signal_strength=50,
            layer_scores={"technical": -0.5},
            price_at_signal=100.0,
            generated_at=datetime.now(timezone.utc),
            outcome_1h="incorrect",
            price_1h_after=102.0,
        ),
    ]
    out = build_signal_analysis_payload(records=recs, period="30d")
    assert out["layer_accuracy"]["technical_predicts_outcome"] == 0.5
