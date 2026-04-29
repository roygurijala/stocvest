from __future__ import annotations

import json

from stocvest.api.handlers.websocket import (
    DynamoDBWebSocketRegistry,
    InMemoryWebSocketRegistry,
    build_default_websocket_registry,
    websocket_connect_handler,
    websocket_default_handler,
    websocket_disconnect_handler,
)
from stocvest.utils.config import Settings


def _event(connection_id: str = "c1", body: str | None = None) -> dict:
    event = {"requestContext": {"connectionId": connection_id, "authorizer": {"claims": {"sub": "u1"}}}}
    if body is not None:
        event["body"] = body
    return event


def test_websocket_connect_and_disconnect() -> None:
    registry = InMemoryWebSocketRegistry()
    connect = websocket_connect_handler(_event("c1"), {}, registry=registry)
    assert connect["statusCode"] == 200
    assert json.loads(connect["body"])["connected"] is True

    disconnect = websocket_disconnect_handler(_event("c1"), {}, registry=registry)
    assert disconnect["statusCode"] == 200
    assert json.loads(disconnect["body"])["disconnected"] is True


def test_websocket_default_ping() -> None:
    registry = InMemoryWebSocketRegistry()
    websocket_connect_handler(_event("c1"), {}, registry=registry)
    response = websocket_default_handler(
        _event("c1", body=json.dumps({"action": "ping"})),
        {},
        registry=registry,
    )
    assert response["statusCode"] == 200
    assert json.loads(response["body"])["action"] == "pong"


def test_websocket_subscribe_unsubscribe_and_list() -> None:
    registry = InMemoryWebSocketRegistry()
    websocket_connect_handler(_event("c1"), {}, registry=registry)

    sub = websocket_default_handler(
        _event("c1", body=json.dumps({"action": "subscribe", "channel": "quotes:AAPL"})),
        {},
        registry=registry,
    )
    assert sub["statusCode"] == 200
    assert "quotes:AAPL" in json.loads(sub["body"])["subscriptions"]

    listed = websocket_default_handler(
        _event("c1", body=json.dumps({"action": "list_subscriptions"})),
        {},
        registry=registry,
    )
    assert listed["statusCode"] == 200
    assert json.loads(listed["body"])["subscriptions"] == ["quotes:AAPL"]

    unsub = websocket_default_handler(
        _event("c1", body=json.dumps({"action": "unsubscribe", "channel": "quotes:AAPL"})),
        {},
        registry=registry,
    )
    assert unsub["statusCode"] == 200
    assert json.loads(unsub["body"])["subscriptions"] == []


def test_websocket_default_validates_action() -> None:
    registry = InMemoryWebSocketRegistry()
    websocket_connect_handler(_event("c1"), {}, registry=registry)
    response = websocket_default_handler(_event("c1", body=json.dumps({})), {}, registry=registry)
    assert response["statusCode"] == 400


def test_websocket_default_requires_connection() -> None:
    registry = InMemoryWebSocketRegistry()
    response = websocket_default_handler(
        _event("c404", body=json.dumps({"action": "list_subscriptions"})),
        {},
        registry=registry,
    )
    assert response["statusCode"] == 400


class _FakeDynamoTable:
    def __init__(self) -> None:
        self.items: dict[str, dict] = {}

    def get_item(self, *, Key: dict) -> dict:
        cid = str(Key["connectionId"])
        item = self.items.get(cid)
        return {"Item": dict(item)} if item else {}

    def put_item(self, *, Item: dict) -> dict:
        self.items[str(Item["connectionId"])] = dict(Item)
        return {}

    def delete_item(self, *, Key: dict) -> dict:
        cid = str(Key["connectionId"])
        self.items.pop(cid, None)
        return {}


def test_dynamodb_registry_persists_subscriptions_and_ttl_refresh() -> None:
    table = _FakeDynamoTable()
    now = {"value": 1_700_000_000}

    def _now() -> int:
        return now["value"]

    registry = DynamoDBWebSocketRegistry(table=table, ttl_seconds=300, now_epoch_provider=_now)
    registry.connect("c1", user_id="u1")
    assert table.items["c1"]["expiresAt"] == 1_700_000_300

    now["value"] += 10
    subs = registry.subscribe("c1", "quotes:AAPL")
    assert "quotes:AAPL" in subs
    assert table.items["c1"]["expiresAt"] == 1_700_000_310

    now["value"] += 10
    listed = registry.subscriptions("c1")
    assert listed == {"quotes:AAPL"}
    assert table.items["c1"]["expiresAt"] == 1_700_000_320


def test_default_registry_falls_back_to_inmemory_only_for_development() -> None:
    dev_settings = Settings.model_validate({"polygon_api_key": "x", "env": "development"})
    registry = build_default_websocket_registry(dev_settings)
    assert isinstance(registry, InMemoryWebSocketRegistry)

    prod_settings = Settings.model_validate({"polygon_api_key": "x", "env": "production"})
    try:
        build_default_websocket_registry(prod_settings)
        assert False, "expected ValueError when table is missing outside development"
    except ValueError as exc:
        assert "STOCVEST_WS_CONNECTIONS_TABLE" in str(exc)

