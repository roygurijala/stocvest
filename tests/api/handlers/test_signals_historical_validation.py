"""
Tests for ``stocvest.api.handlers.signals.historical_validation_summary_handler``.

These lock in the Phase 3a HTTP contract that the dashboard UI (Phase 3b) will depend on:

- Auth required (`rc.user_id` enforced) — every query is scoped to the calling user.
- ``horizon`` must be `1h` or `1d`; missing / invalid → 400.
- ``from`` / ``to`` must be parseable ISO-8601 datetimes; ``to`` must be strictly after
  ``from``; inverted window → 400.
- ``mode`` / ``symbol`` pass straight through to the service.
- ``by_version=true`` returns the per-`parameter_version` map with a synthetic `__all__`
  bucket; the default response carries a single ``summary``.
- ``BucketStats.accuracy`` of NaN is serialized to JSON `null` (not the literal `NaN`),
  so the response is valid JSON and the UI can render "—" instead of a misleading "0%".
- Response always carries the standing historical-validation disclaimer verbatim from
  ``stocvest.api.legal_copy.HISTORICAL_VALIDATION_DISCLAIMER``.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

from stocvest.api.handlers.signals import historical_validation_summary_handler
from stocvest.api.legal_copy import HISTORICAL_VALIDATION_DISCLAIMER
from stocvest.api.services.signal_recorder import (
    InMemorySignalRecorder,
    reset_signal_recorder_for_tests,
)
from stocvest.data.models import SignalRecord


# ─────────────────────────────────────────────────────────────────────────────
# Test fixtures
# ─────────────────────────────────────────────────────────────────────────────


def _signal(
    *,
    signal_id: str,
    user_id: str = "u1",
    symbol: str = "AAPL",
    direction: str = "bullish",
    signal_strength: int = 75,
    pattern: str = "swing_composite",
    mode: str = "swing",
    outcome_1h: str | None = None,
    outcome_1d: str | None = None,
    parameter_version: str | None = "v1",
    generated_at: datetime | None = None,
    decision_state_entry: str | None = "actionable",
    regime_label_at_entry: str | None = "risk_on",
) -> SignalRecord:
    return SignalRecord(
        signal_id=signal_id,
        symbol=symbol,
        direction=direction,
        signal_strength=signal_strength,
        pattern=pattern,
        layer_scores={},
        price_at_signal=100.0,
        generated_at=generated_at or datetime.now(timezone.utc) - timedelta(hours=2),
        outcome_1h=outcome_1h,
        outcome_1d=outcome_1d,
        mode=mode,
        decision_state_entry=decision_state_entry,
        regime_label_at_entry=regime_label_at_entry,
        parameter_version=parameter_version,
        user_id=user_id,
    )


def _event(
    *,
    user_id: str | None = "u1",
    qs: dict[str, str] | None = None,
) -> dict:
    """Build a Lambda-style event matching how API Gateway hands a JWT-authorized GET."""

    return {
        "requestContext": {
            "http": {
                "method": "GET",
                "path": "/v1/signals/historical-validation/summary",
            },
            "authorizer": {"claims": {"sub": user_id}} if user_id else {},
        },
        "queryStringParameters": qs,
    }


def _window_qs(
    *,
    horizon: str = "1h",
    days_back: int = 7,
    extras: dict[str, str] | None = None,
) -> dict[str, str]:
    """Standard window: from = now - days_back, to = now + 1h (so all 'now' rows fit)."""

    now = datetime.now(timezone.utc)
    qs: dict[str, str] = {
        "horizon": horizon,
        "from": (now - timedelta(days=days_back)).isoformat().replace("+00:00", "Z"),
        "to": (now + timedelta(hours=1)).isoformat().replace("+00:00", "Z"),
    }
    if extras:
        qs.update(extras)
    return qs


# ─────────────────────────────────────────────────────────────────────────────
# Auth + query-param validation
# ─────────────────────────────────────────────────────────────────────────────


def test_requires_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    resp = historical_validation_summary_handler(_event(user_id=None, qs=_window_qs()), {})

    assert resp["statusCode"] == 401
    assert json.loads(resp["body"])["error"] == "unauthorized"


def test_rejects_missing_horizon(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    qs = _window_qs()
    qs.pop("horizon")
    resp = historical_validation_summary_handler(_event(qs=qs), {})

    assert resp["statusCode"] == 400
    body = json.loads(resp["body"])
    assert body["error"] == "bad_request"
    assert "horizon" in body["message"]


def test_rejects_invalid_horizon(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    resp = historical_validation_summary_handler(
        _event(qs=_window_qs(horizon="1w")), {}
    )

    assert resp["statusCode"] == 400


def test_rejects_missing_from(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    qs = _window_qs()
    qs.pop("from")
    resp = historical_validation_summary_handler(_event(qs=qs), {})

    assert resp["statusCode"] == 400
    assert "from" in json.loads(resp["body"])["message"]


def test_rejects_invalid_from(monkeypatch: pytest.MonkeyPatch) -> None:
    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    qs = _window_qs()
    qs["from"] = "not-a-date"
    resp = historical_validation_summary_handler(_event(qs=qs), {})

    assert resp["statusCode"] == 400


def test_rejects_inverted_window(monkeypatch: pytest.MonkeyPatch) -> None:
    """``to`` must be strictly after ``from``; equal bounds are also a 400 — there is no
    legitimate caller use case for "window of length zero" and the dashboard's date
    picker only emits monotonic ranges anyway."""

    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    now = datetime.now(timezone.utc)
    qs = {
        "horizon": "1h",
        "from": (now).isoformat().replace("+00:00", "Z"),
        "to": (now - timedelta(days=1)).isoformat().replace("+00:00", "Z"),
    }
    resp = historical_validation_summary_handler(_event(qs=qs), {})

    assert resp["statusCode"] == 400
    assert "after" in json.loads(resp["body"])["message"]


def test_accepts_iso_with_trailing_z(monkeypatch: pytest.MonkeyPatch) -> None:
    """JavaScript's `Date.toISOString()` emits the trailing-Z form. Must be accepted."""

    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    resp = historical_validation_summary_handler(_event(qs=_window_qs()), {})

    assert resp["statusCode"] == 200


# ─────────────────────────────────────────────────────────────────────────────
# Happy-path summary
# ─────────────────────────────────────────────────────────────────────────────


def test_happy_path_returns_summary_with_disclaimer(monkeypatch: pytest.MonkeyPatch) -> None:
    """Two correct + one incorrect at 1h → 2/3 directional accuracy. Standing disclaimer
    rides on every response."""

    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    mem.record_signal(_signal(signal_id="a", outcome_1h="correct"))
    mem.record_signal(_signal(signal_id="b", outcome_1h="correct"))
    mem.record_signal(_signal(signal_id="c", outcome_1h="incorrect"))

    resp = historical_validation_summary_handler(_event(qs=_window_qs()), {})

    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["horizon"] == "1h"
    assert body["disclaimer"] == HISTORICAL_VALIDATION_DISCLAIMER
    assert body["mode"] is None
    assert body["symbol"] is None

    summary = body["summary"]
    assert summary["horizon"] == "1h"
    assert summary["overall"]["total_signals"] == 3
    assert summary["overall"]["correct"] == 2
    assert summary["overall"]["incorrect"] == 1
    assert summary["overall"]["accuracy"] == pytest.approx(2 / 3)
    assert summary["parameter_versions"] == ["v1"]


def test_empty_window_serializes_nan_accuracy_as_null(monkeypatch: pytest.MonkeyPatch) -> None:
    """No rows → accuracy NaN at the Phase 1 layer → JSON `null` at the wire so the UI
    can render "—" and the response stays valid JSON (default ``json.dumps`` would
    emit the literal ``NaN``, which crashes browsers).
    """

    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    resp = historical_validation_summary_handler(_event(qs=_window_qs()), {})

    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["summary"]["overall"]["total_signals"] == 0
    assert body["summary"]["overall"]["accuracy"] is None
    # raw JSON body must NOT contain the literal "NaN" token — locks in JSON validity
    assert "NaN" not in resp["body"]


def test_scope_isolates_users(monkeypatch: pytest.MonkeyPatch) -> None:
    """User A's tracked outcomes must not bleed into User B's response."""

    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    mem.record_signal(_signal(signal_id="a1", user_id="u-alpha", outcome_1h="correct"))
    mem.record_signal(_signal(signal_id="a2", user_id="u-alpha", outcome_1h="correct"))
    mem.record_signal(_signal(signal_id="b1", user_id="u-beta", outcome_1h="incorrect"))

    resp_alpha = historical_validation_summary_handler(
        _event(user_id="u-alpha", qs=_window_qs()), {}
    )
    resp_beta = historical_validation_summary_handler(
        _event(user_id="u-beta", qs=_window_qs()), {}
    )

    alpha = json.loads(resp_alpha["body"])["summary"]
    beta = json.loads(resp_beta["body"])["summary"]

    assert alpha["overall"]["correct"] == 2
    assert alpha["overall"]["incorrect"] == 0
    assert beta["overall"]["correct"] == 0
    assert beta["overall"]["incorrect"] == 1


def test_mode_filter_passes_through(monkeypatch: pytest.MonkeyPatch) -> None:
    """``mode=day`` filters at the store; swing rows do not appear in the response totals."""

    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    mem.record_signal(_signal(signal_id="swing1", mode="swing", outcome_1h="correct"))
    mem.record_signal(_signal(signal_id="day1", mode="day", outcome_1h="correct"))
    mem.record_signal(_signal(signal_id="day2", mode="day", outcome_1h="incorrect"))

    resp = historical_validation_summary_handler(
        _event(qs=_window_qs(extras={"mode": "day"})), {}
    )

    body = json.loads(resp["body"])
    assert body["mode"] == "day"
    assert body["summary"]["overall"]["total_signals"] == 2
    assert body["summary"]["overall"]["correct"] == 1
    assert body["summary"]["overall"]["incorrect"] == 1


def test_symbol_filter_passes_through(monkeypatch: pytest.MonkeyPatch) -> None:
    """``symbol=MSFT`` (lowercase tolerated) filters at the store."""

    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    mem.record_signal(_signal(signal_id="aapl1", symbol="AAPL", outcome_1h="correct"))
    mem.record_signal(_signal(signal_id="msft1", symbol="MSFT", outcome_1h="incorrect"))

    resp = historical_validation_summary_handler(
        _event(qs=_window_qs(extras={"symbol": "msft"})), {}
    )

    body = json.loads(resp["body"])
    assert body["symbol"] == "MSFT"
    assert body["summary"]["overall"]["total_signals"] == 1
    assert body["summary"]["overall"]["incorrect"] == 1


def test_horizon_1d_reads_outcome_1d_column(monkeypatch: pytest.MonkeyPatch) -> None:
    """A row with only `outcome_1h` populated counts as zero in the 1d denominator but
    still appears in `rows_examined` — same Phase 1 contract end-to-end."""

    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    mem.record_signal(_signal(signal_id="pending1d", outcome_1h="correct", outcome_1d=None))

    resp = historical_validation_summary_handler(
        _event(qs=_window_qs(horizon="1d")), {}
    )

    body = json.loads(resp["body"])
    summary = body["summary"]
    assert summary["horizon"] == "1d"
    assert summary["overall"]["total_signals"] == 0
    assert summary["overall"]["accuracy"] is None
    assert summary["rows_examined"] == 1


# ─────────────────────────────────────────────────────────────────────────────
# by_version=true response shape
# ─────────────────────────────────────────────────────────────────────────────


def test_by_version_returns_per_version_map_with_all_bucket(monkeypatch: pytest.MonkeyPatch) -> None:
    """v1 = 2/2 correct, v2 = 1 correct + 1 incorrect → response has v1, v2, and
    `__all__` buckets. `__all__` carries 3/4 = 0.75. The handler does not lose the
    Phase 1 `parameter_versions` provenance."""

    reset_signal_recorder_for_tests()
    mem = InMemorySignalRecorder()
    monkeypatch.setattr("stocvest.api.handlers.signals.get_signal_recorder", lambda: mem)

    mem.record_signal(_signal(signal_id="v1a", parameter_version="v1", outcome_1h="correct"))
    mem.record_signal(_signal(signal_id="v1b", parameter_version="v1", outcome_1h="correct"))
    mem.record_signal(_signal(signal_id="v2a", parameter_version="v2", outcome_1h="correct"))
    mem.record_signal(_signal(signal_id="v2b", parameter_version="v2", outcome_1h="incorrect"))

    resp = historical_validation_summary_handler(
        _event(qs=_window_qs(extras={"by_version": "true"})), {}
    )

    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert "summary" not in body
    by_version = body["by_parameter_version"]
    assert set(by_version.keys()) == {"__all__", "v1", "v2"}

    assert by_version["v1"]["overall"]["correct"] == 2
    assert by_version["v1"]["overall"]["accuracy"] == 1.0

    assert by_version["v2"]["overall"]["correct"] == 1
    assert by_version["v2"]["overall"]["incorrect"] == 1
    assert by_version["v2"]["overall"]["accuracy"] == 0.5

    all_bucket = by_version["__all__"]
    assert all_bucket["overall"]["correct"] == 3
    assert all_bucket["overall"]["incorrect"] == 1
    assert all_bucket["overall"]["accuracy"] == 0.75
    assert all_bucket["parameter_versions"] == ["v1", "v2"]
