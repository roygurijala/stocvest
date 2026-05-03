from __future__ import annotations

import json

from stocvest.api.handlers.journal import (
    journal_create_entry_handler,
    journal_list_entries_handler,
    journal_patch_entry_handler,
)


def _event_with_user_sub(user_sub: str, body: dict[str, object] | None = None) -> dict[str, object]:
    return {
        "requestContext": {"authorizer": {"claims": {"sub": user_sub}}},
        "body": json.dumps(body) if body is not None else None,
    }


def test_journal_create_and_list_entries_for_user() -> None:
    create_event = _event_with_user_sub(
        "user-1",
        {
            "entry_id": "e-api-1",
            "symbol": "aapl",
            "opening_side": "buy",
            "quantity": 2,
            "is_day_trade": True,
            "strategy_tags": ["orb"],
        },
    )
    create_response = journal_create_entry_handler(create_event, {})
    assert create_response["statusCode"] == 200
    created_body = json.loads(create_response["body"])
    assert created_body["symbol"] == "AAPL"
    assert created_body["user_id"] == "user-1"

    list_response = journal_list_entries_handler(_event_with_user_sub("user-1"), {})
    assert list_response["statusCode"] == 200
    rows = json.loads(list_response["body"])
    assert any(row["entry_id"] == "e-api-1" for row in rows)


def test_journal_requires_authenticated_user() -> None:
    response = journal_list_entries_handler({"requestContext": {}, "body": None}, {})
    assert response["statusCode"] == 401


def test_journal_create_rejects_client_supplied_user_id() -> None:
    create_event = _event_with_user_sub(
        "user-1",
        {
            "entry_id": "e-api-bad-user",
            "user_id": "attacker",
            "symbol": "aapl",
            "opening_side": "buy",
            "quantity": 1,
            "strategy_tags": [],
        },
    )
    create_response = journal_create_entry_handler(create_event, {})
    assert create_response["statusCode"] == 400


def test_journal_patch_strips_control_characters_from_notes() -> None:
    create_event = _event_with_user_sub(
        "user-2",
        {
            "entry_id": "e-api-2",
            "symbol": "msft",
            "opening_side": "buy",
            "quantity": 1,
            "strategy_tags": [],
        },
    )
    assert journal_create_entry_handler(create_event, {})["statusCode"] == 200
    patch_event: dict[str, object] = {
        "requestContext": {"authorizer": {"claims": {"sub": "user-2"}}},
        "path": "/v1/journal/entries/e-api-2",
        "httpMethod": "PATCH",
        "body": json.dumps({"notes": "ok\x00note"}),
    }
    patch_response = journal_patch_entry_handler(patch_event, {})
    assert patch_response["statusCode"] == 200
    body = json.loads(patch_response["body"])
    assert body["entry_notes"] == "oknote"
