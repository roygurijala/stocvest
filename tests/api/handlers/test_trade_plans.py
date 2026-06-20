from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from stocvest.api.handlers.trade_plans import (
    trade_plans_delete_handler,
    trade_plans_list_handler,
    trade_plans_sync_handler,
    trade_plans_thesis_alerts_handler,
    trade_plans_upsert_handler,
)
from stocvest.signals.tracked_trade_plan import TrackedPlanLevels, TrackedTradePlan

pytestmark = pytest.mark.unit


def _event_with_user_sub(user_sub: str, body: dict[str, object] | None = None) -> dict[str, object]:
    return {
        "requestContext": {"authorizer": {"claims": {"sub": user_sub}}},
        "body": json.dumps(body) if body is not None else None,
    }


def _sample_plan_payload(plan_id: str = "swing:AAPL:1") -> dict[str, object]:
    return {
        "id": plan_id,
        "symbol": "AAPL",
        "mode": "swing",
        "committedAt": "2026-06-10T14:00:00+00:00",
        "bias": "Bullish",
        "levels": {
            "entryLow": 180,
            "entryHigh": 185,
            "stop": 170,
            "target1": 200,
            "priceAtCommit": 182,
            "riskRewardAtCommit": 2.1,
        },
    }


def test_trade_plans_upsert_list_and_delete() -> None:
    upsert = trade_plans_upsert_handler(_event_with_user_sub("user-tp-1", _sample_plan_payload()), {})
    assert upsert["statusCode"] == 200
    body = json.loads(upsert["body"])
    assert body["symbol"] == "AAPL"

    listed = trade_plans_list_handler(_event_with_user_sub("user-tp-1"), {})
    assert listed["statusCode"] == 200
    rows = json.loads(listed["body"])
    assert len(rows) == 1

    deleted = trade_plans_delete_handler(
        {
            "requestContext": {"authorizer": {"claims": {"sub": "user-tp-1"}}},
            "pathParameters": {"plan_id": "swing:AAPL:1"},
        },
        {},
    )
    assert deleted["statusCode"] == 200

    listed_after = trade_plans_list_handler(_event_with_user_sub("user-tp-1"), {})
    assert json.loads(listed_after["body"]) == []


def test_trade_plans_sync_merges_by_newest_commit() -> None:
    older = _sample_plan_payload("swing:MSFT:1")
    older["symbol"] = "MSFT"
    older["committedAt"] = "2026-06-09T14:00:00+00:00"
    newer = _sample_plan_payload("swing:MSFT:2")
    newer["symbol"] = "MSFT"
    newer["committedAt"] = "2026-06-11T14:00:00+00:00"
    newer["levels"] = {
        "entryLow": 400,
        "entryHigh": 410,
        "stop": 390,
        "target1": 430,
        "priceAtCommit": 405,
    }

    trade_plans_upsert_handler(_event_with_user_sub("user-tp-2", older), {})
    sync = trade_plans_sync_handler(
        _event_with_user_sub("user-tp-2", {"plans": [older, newer]}),
        {},
    )
    assert sync["statusCode"] == 200
    rows = json.loads(sync["body"])
    assert len(rows) == 1
    assert rows[0]["id"] == "swing:MSFT:2"
    assert rows[0]["levels"]["entryLow"] == 400


def test_trade_plans_requires_authenticated_user() -> None:
    response = trade_plans_list_handler({"requestContext": {}, "body": None}, {})
    assert response["statusCode"] == 401


def test_trade_plans_thesis_alerts_requires_authenticated_user() -> None:
    response = trade_plans_thesis_alerts_handler({"requestContext": {}, "body": None}, {})
    assert response["statusCode"] == 401


def test_trade_plans_thesis_alerts_rejects_non_array() -> None:
    event = _event_with_user_sub("user-tp-ta", {"assessments": "nope"})
    response = trade_plans_thesis_alerts_handler(event, {})
    assert response["statusCode"] == 400


def test_trade_plans_thesis_alerts_returns_sent_count() -> None:
    # End-to-end through the notify pipeline: with no profile email on file the
    # handler still returns 200 with an integer `sent` count (0). Exercises routing,
    # body parsing, auth, and the rank/status gating without fragile profile mocking.
    event = _event_with_user_sub(
        "user-tp-ta-2",
        {
            "assessments": [
                {
                    "planId": "swing:AAPL:1",
                    "symbol": "AAPL",
                    "mode": "swing",
                    "previousStatus": "valid",
                    "thesisStatus": "weakened",
                    "thesisLabel": "Thesis weakened",
                    "thesisHint": "Layer alignment fell.",
                    "triggerLabel": "Wait for entry zone",
                }
            ]
        },
    )
    response = trade_plans_thesis_alerts_handler(event, {})
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert isinstance(body["sent"], int)
    assert body["sent"] >= 0


def test_tracked_trade_plan_round_trip() -> None:
    plan = TrackedTradePlan(
        plan_id="day:TSLA:1",
        user_id="u1",
        symbol="TSLA",
        mode="day",
        committed_at=datetime(2026, 6, 10, 14, 0, tzinfo=timezone.utc),
        bias="Bearish",
        levels=TrackedPlanLevels(
            entry_low=250,
            entry_high=255,
            stop=260,
            target1=240,
            target2=None,
            price_at_commit=252,
            risk_reward_at_commit=2.0,
        ),
    )
    restored = TrackedTradePlan.from_dynamo_item(user_id="u1", item=plan.to_dynamo_item())
    assert restored.symbol == "TSLA"
    assert restored.levels.stop == 260
