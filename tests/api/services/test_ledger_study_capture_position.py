"""maybe_persist_position_ledger_row — ADR-004 POS-D9 capture wrapper."""

from __future__ import annotations

import pytest

import stocvest.api.services.ledger_study_capture as lsc
from stocvest.api.services.signal_recorder import InMemorySignalRecorder
from stocvest.config.parameter_store import ParameterStore
from stocvest.signals.composite_score import CompositeVerdict


@pytest.fixture()
def recorder(monkeypatch: pytest.MonkeyPatch) -> InMemorySignalRecorder:
    rec = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.services.signal_recorder._recorder", rec)
    return rec


def _call(**overrides):
    params = ParameterStore.get_parameters_sync()
    kwargs = dict(
        ledger_capture=True,
        user_id="platform-position-ledger",
        symbol="AAPL",
        response_status="active",
        verdict=CompositeVerdict.NEUTRAL,
        risk_reward=2.5,
        price_at_signal=190.0,
        layer_scores={"fundamentals": 60.0, "technical": 55.0},
        signal_strength=60,
        pattern="position_composite",
        params=params,
        snapshot_blobs={},
        layer_scores_json=None,
        stop_level=170.0,
        reference_structure_level=220.0,
        regime_label="neutral",
        sector_label="Technology",
        market_environment={"environment_tier": "normal"},
    )
    kwargs.update(overrides)
    return lsc.maybe_persist_position_ledger_row(**kwargs)


def test_no_user_id_skips(recorder: InMemorySignalRecorder) -> None:
    eligible, gates = _call(user_id=None)
    assert eligible is False and gates == {}
    assert recorder.scan_all_records() == []


def test_neutral_verdict_writes_shadow_row(recorder: InMemorySignalRecorder) -> None:
    # Neutral -> decision_state not actionable -> shadow row (ledger_capture=True).
    eligible, _gates = _call(verdict=CompositeVerdict.NEUTRAL)
    assert eligible is False
    rows = recorder.scan_all_records()
    # user-scoped shadow + PUBLIC mirror.
    assert any(r.mode == "position" and r.capture_kind == "shadow" for r in rows)
    for r in rows:
        assert r.ledger_qualified is False
        assert r.ledger_position_open is False


def test_placeholder_price_when_missing_but_capture_on(recorder: InMemorySignalRecorder) -> None:
    eligible, _gates = _call(price_at_signal=None)
    assert eligible is False
    rows = [r for r in recorder.scan_all_records() if r.user_id]
    assert rows and rows[0].price_at_signal == pytest.approx(0.01)


def test_qualified_path_opens_position(monkeypatch: pytest.MonkeyPatch, recorder: InMemorySignalRecorder) -> None:
    # Isolate the wrapper from gate internals: force actionable + inside Friday window.
    monkeypatch.setattr(lsc, "evaluate_position_desk_entry", lambda **_: (True, {"decision_state": {"pass": True}}))
    monkeypatch.setattr(lsc, "is_position_ledger_entry_window_et", lambda _now: True)
    eligible, _gates = _call(verdict=CompositeVerdict.BULLISH)
    assert eligible is True
    user_rows = [r for r in recorder.scan_all_records() if r.user_id]
    assert len(user_rows) == 1
    row = user_rows[0]
    assert row.mode == "position"
    assert row.capture_kind == "qualified"
    assert row.ledger_qualified is True
    assert row.ledger_position_open is True
    assert row.ledger_entry_date_et is not None


def test_outside_friday_window_downgrades_to_shadow(monkeypatch: pytest.MonkeyPatch, recorder: InMemorySignalRecorder) -> None:
    monkeypatch.setattr(lsc, "evaluate_position_desk_entry", lambda **_: (True, {}))
    monkeypatch.setattr(lsc, "is_position_ledger_entry_window_et", lambda _now: False)
    eligible, gates = _call(verdict=CompositeVerdict.BULLISH)
    assert eligible is False
    assert gates["entry_weekly_close_window"]["pass"] is False


def test_dedupe_blocks_second_open(monkeypatch: pytest.MonkeyPatch, recorder: InMemorySignalRecorder) -> None:
    monkeypatch.setattr(lsc, "evaluate_position_desk_entry", lambda **_: (True, {}))
    monkeypatch.setattr(lsc, "is_position_ledger_entry_window_et", lambda _now: True)
    first, _ = _call(verdict=CompositeVerdict.BULLISH)
    assert first is True
    second, gates = _call(verdict=CompositeVerdict.BULLISH)
    assert second is False
    assert gates["dedupe_open_position"]["pass"] is False
