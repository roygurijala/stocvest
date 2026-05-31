"""Lock-in tests for admin desk backtesting routes."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from stocvest.api.handlers.admin_desk_backtest import (
    admin_environment_policy_backtest_handler,
    admin_historical_validation_summary_handler,
)
from stocvest.api.services.signal_recorder import (
    InMemorySignalRecorder,
    reset_signal_recorder_for_tests,
)
from stocvest.data.models import SignalRecord
from tests.signals.test_environment_policy_backtest import _record


def _evt(
    *,
    path: str,
    qs: dict[str, str] | None = None,
    sub: str = "admin-1",
) -> dict:
    return {
        "path": path,
        "pathParameters": None,
        "queryStringParameters": dict(qs) if qs else None,
        "requestContext": {
            "requestId": "req-test",
            "http": {"method": "GET", "path": path},
            "authorizer": {"claims": {"sub": sub}},
        },
        "headers": {},
    }


@pytest.fixture(autouse=True)
def _reset_recorder() -> None:
    reset_signal_recorder_for_tests()


def test_historical_validation_requires_admin() -> None:
    event = _evt(
        path="/v1/admin/historical-validation/summary",
        qs={
            "horizon": "1d",
            "from": "2026-01-01T00:00:00Z",
            "to": "2026-06-01T00:00:00Z",
        },
    )
    with patch(
        "stocvest.api.handlers.admin_desk_backtest.analysis_authorized",
        return_value=False,
    ):
        resp = admin_historical_validation_summary_handler(event, None)
    assert resp["statusCode"] == 403


def test_historical_validation_public_scope() -> None:
    rec = SignalRecord(
        signal_id="pub-1",
        symbol="AAPL",
        direction="bullish",
        signal_strength=80,
        pattern="swing_composite",
        layer_scores={},
        price_at_signal=100.0,
        generated_at=datetime(2026, 2, 1, tzinfo=timezone.utc),
        outcome_1d="correct",
        mode="swing",
        user_id=None,
        decision_state_entry="actionable",
    )
    store = InMemorySignalRecorder()
    store.record_signal(rec)
    event = _evt(
        path="/v1/admin/historical-validation/summary",
        qs={
            "horizon": "1d",
            "from": "2026-01-01T00:00:00Z",
            "to": "2026-06-01T00:00:00Z",
            "scope": "public",
        },
    )
    with patch(
        "stocvest.api.handlers.admin_desk_backtest.analysis_authorized",
        return_value=True,
    ), patch(
        "stocvest.api.handlers.admin_desk_backtest.get_signal_recorder",
        return_value=store,
    ):
        resp = admin_historical_validation_summary_handler(event, None)
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["scope"] == "public"
    assert body["summary"]["overall"]["correct"] == 1


def test_environment_backtest_returns_ranked_candidates() -> None:
    store = InMemorySignalRecorder()
    store.record_signal(_record(vix=18, tier="normal", outcome_1d="correct"))
    store.record_signal(_record(vix=29, tier="stressed", outcome_1d="incorrect"))
    event = _evt(
        path="/v1/admin/environment-policy/backtest",
        qs={"days": "180", "horizon": "1d", "mode": "swing", "top": "5"},
    )
    with patch(
        "stocvest.api.handlers.admin_desk_backtest.analysis_authorized",
        return_value=True,
    ), patch(
        "stocvest.api.handlers.admin_desk_backtest.get_signal_recorder",
        return_value=store,
    ):
        resp = admin_environment_policy_backtest_handler(event, None)
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["rows_with_vix"] >= 1
    assert len(body["candidates"]) >= 1
    assert any(c["is_production"] for c in body["candidates"])
