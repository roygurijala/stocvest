from __future__ import annotations

import json

from stocvest.api.handlers.journal import journal_create_entry_handler
from stocvest.api.handlers.pdt import pdt_status_handler


def _event_with_user_sub(user_sub: str, body: dict[str, object] | None = None) -> dict[str, object]:
    return {
        "requestContext": {"authorizer": {"claims": {"sub": user_sub}}},
        "body": json.dumps(body) if body is not None else None,
    }


def test_pdt_status_warns_when_near_limit() -> None:
    # seed two day trades for this user (fixed dates so as_of is stable across runner clocks)
    for opened_at, idx in (
        ("2026-04-28T14:30:00+00:00", "1"),
        ("2026-04-29T15:00:00+00:00", "2"),
    ):
        journal_create_entry_handler(
            _event_with_user_sub(
                "pdt-user",
                {
                    "entry_id": f"pdt-{idx}",
                    "symbol": "AAPL",
                    "opening_side": "buy",
                    "quantity": 1,
                    "is_day_trade": True,
                    "opened_at": opened_at,
                },
            ),
            {},
        )

    response = pdt_status_handler(
        {
            **_event_with_user_sub("pdt-user"),
            "queryStringParameters": {"as_of": "2026-04-29"},
        },
        {},
    )
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assessment = body["assessment"]
    assert assessment["day_trades_in_window"] == 2
    assert assessment["current_day_trade_count"] == 2
    assert assessment["warn_near_limit"] is True
    assert assessment["days_until_reset"] >= 1


def test_pdt_status_at_limit_after_three_day_trades() -> None:
    for opened_at, suffix in (
        ("2026-04-27T14:30:00+00:00", "1"),
        ("2026-04-28T14:30:00+00:00", "2"),
        ("2026-04-29T14:30:00+00:00", "3"),
    ):
        journal_create_entry_handler(
            _event_with_user_sub(
                "pdt-limit",
                {
                    "entry_id": f"pdt-limit-{suffix}",
                    "symbol": "MSFT",
                    "opening_side": "buy",
                    "quantity": 1,
                    "is_day_trade": True,
                    "opened_at": opened_at,
                },
            ),
            {},
        )
    response = pdt_status_handler(
        {
            **_event_with_user_sub("pdt-limit"),
            "queryStringParameters": {"as_of": "2026-04-29"},
        },
        {},
    )
    body = json.loads(response["body"])
    assessment = body["assessment"]
    assert assessment["day_trades_in_window"] == 3
    assert assessment["at_limit"] is True
    assert assessment["allow_next_day_trade"] is False


def test_pdt_status_weekend_as_of_uses_friday_window() -> None:
    journal_create_entry_handler(
        _event_with_user_sub(
            "pdt-weekend",
            {
                "entry_id": "pdt-weekend-1",
                "symbol": "SPY",
                "opening_side": "buy",
                "quantity": 1,
                "is_day_trade": True,
                "opened_at": "2026-04-24T15:00:00+00:00",
            },
        ),
        {},
    )
    response = pdt_status_handler(
        {
            **_event_with_user_sub("pdt-weekend"),
            "queryStringParameters": {"as_of": "2026-04-26"},
        },
        {},
    )
    body = json.loads(response["body"])
    assessment = body["assessment"]
    assert assessment["day_trades_in_window"] == 1
    assert assessment["days_until_reset"] > 0


def test_pdt_status_invalid_as_of_falls_back_to_today() -> None:
    response = pdt_status_handler(
        {
            **_event_with_user_sub("pdt-invalid"),
            "queryStringParameters": {"as_of": "not-a-date"},
        },
        {},
    )
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert "assessment" in body


def test_pdt_status_respects_pdt_exempt_override_query() -> None:
    for idx in ("1", "2", "3"):
        journal_create_entry_handler(
            _event_with_user_sub(
                "pdt-exempt",
                {
                    "entry_id": f"pdt-exempt-{idx}",
                    "symbol": "QQQ",
                    "opening_side": "buy",
                    "quantity": 1,
                    "is_day_trade": True,
                    "opened_at": f"2026-04-2{idx}T14:30:00+00:00",
                },
            ),
            {},
        )
    response = pdt_status_handler(
        {
            **_event_with_user_sub("pdt-exempt"),
            "queryStringParameters": {"as_of": "2026-04-29", "pdt_exempt": "true"},
        },
        {},
    )
    body = json.loads(response["body"])
    assessment = body["assessment"]
    assert assessment["pdt_exempt"] is True
    assert assessment["allow_next_day_trade"] is True


def test_pdt_status_requires_authentication() -> None:
    response = pdt_status_handler({"requestContext": {}, "body": None}, {})
    assert response["statusCode"] == 401
