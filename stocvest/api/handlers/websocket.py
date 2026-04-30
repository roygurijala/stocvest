"""Phase 4g WebSocket handlers for API Gateway routes."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
from typing import Any, Callable, Protocol

from stocvest.api.response import bad_request, internal_error, ok
from stocvest.api.services.ws_connection_index import (
    SCANNER_UPDATES_CHANNEL,
    index_subscribe_scanner_updates,
    index_unsubscribe_scanner_updates,
)
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.utils.config import Settings, get_settings


@dataclass
class ConnectionState:
    connection_id: str
    user_id: str | None = None
    subscriptions: set[str] = field(default_factory=set)


class WebSocketRegistry(Protocol):
    def connect(self, connection_id: str, user_id: str | None = None) -> None: ...
    def disconnect(self, connection_id: str) -> None: ...
    def subscribe(self, connection_id: str, channel: str) -> set[str]: ...
    def unsubscribe(self, connection_id: str, channel: str) -> set[str]: ...
    def subscriptions(self, connection_id: str) -> set[str]: ...


class InMemoryWebSocketRegistry:
    """In-memory fallback registry for local development only."""

    def __init__(self) -> None:
        self._connections: dict[str, ConnectionState] = {}

    def connect(self, connection_id: str, user_id: str | None = None) -> None:
        self._connections[connection_id] = ConnectionState(connection_id=connection_id, user_id=user_id)

    def disconnect(self, connection_id: str) -> None:
        self._connections.pop(connection_id, None)

    def subscribe(self, connection_id: str, channel: str) -> set[str]:
        state = self._require(connection_id)
        state.subscriptions.add(channel)
        return set(state.subscriptions)

    def unsubscribe(self, connection_id: str, channel: str) -> set[str]:
        state = self._require(connection_id)
        state.subscriptions.discard(channel)
        return set(state.subscriptions)

    def subscriptions(self, connection_id: str) -> set[str]:
        return set(self._require(connection_id).subscriptions)

    def _require(self, connection_id: str) -> ConnectionState:
        state = self._connections.get(connection_id)
        if state is None:
            raise KeyError(f"Unknown connection_id: {connection_id}")
        return state


class DynamoDBTableLike(Protocol):
    def get_item(self, *, Key: dict[str, Any]) -> dict[str, Any]: ...
    def put_item(self, *, Item: dict[str, Any]) -> dict[str, Any]: ...
    def delete_item(self, *, Key: dict[str, Any]) -> dict[str, Any]: ...


class DynamoDBWebSocketRegistry:
    """DynamoDB-backed connection registry with TTL refresh on writes/reads."""

    def __init__(
        self,
        *,
        table: DynamoDBTableLike,
        ttl_seconds: int = 86400,
        now_epoch_provider: Callable[[], int] | None = None,
    ) -> None:
        self._table = table
        self._ttl_seconds = max(60, int(ttl_seconds))
        self._now_epoch_provider = now_epoch_provider or (lambda: int(datetime.now(tz=timezone.utc).timestamp()))

    @classmethod
    def from_settings(cls, settings: Settings | None = None) -> "DynamoDBWebSocketRegistry":
        cfg = settings or get_settings()
        table_name = cfg.websocket_connections_table.strip()
        if not table_name:
            raise ValueError("STOCVEST_WS_CONNECTIONS_TABLE is required for DynamoDB WebSocket registry.")
        import boto3

        kwargs: dict[str, Any] = {"region_name": cfg.aws_region}
        if cfg.dynamodb_endpoint_url:
            kwargs["endpoint_url"] = cfg.dynamodb_endpoint_url
        dynamodb = boto3.resource("dynamodb", **kwargs)
        table = dynamodb.Table(table_name)
        return cls(table=table, ttl_seconds=cfg.websocket_connection_ttl_seconds)

    def connect(self, connection_id: str, user_id: str | None = None) -> None:
        state = ConnectionState(connection_id=connection_id, user_id=user_id, subscriptions=set())
        self._put_state(state)

    def disconnect(self, connection_id: str) -> None:
        self._table.delete_item(Key={"connectionId": connection_id})

    def subscribe(self, connection_id: str, channel: str) -> set[str]:
        state = self._require_state(connection_id)
        state.subscriptions.add(channel)
        self._put_state(state)
        return set(state.subscriptions)

    def unsubscribe(self, connection_id: str, channel: str) -> set[str]:
        state = self._require_state(connection_id)
        state.subscriptions.discard(channel)
        self._put_state(state)
        return set(state.subscriptions)

    def subscriptions(self, connection_id: str) -> set[str]:
        state = self._require_state(connection_id)
        # touch ttl on read/list so active connections do not expire.
        self._put_state(state)
        return set(state.subscriptions)

    def _put_state(self, state: ConnectionState) -> None:
        now = int(self._now_epoch_provider())
        self._table.put_item(
            Item={
                "connectionId": state.connection_id,
                "userId": state.user_id,
                "subscriptions": sorted(state.subscriptions),
                "expiresAt": now + self._ttl_seconds,
            }
        )

    def _require_state(self, connection_id: str) -> ConnectionState:
        resp = self._table.get_item(Key={"connectionId": connection_id})
        item = resp.get("Item")
        if not item:
            raise KeyError(f"Unknown connection_id: {connection_id}")
        return ConnectionState(
            connection_id=connection_id,
            user_id=item.get("userId"),
            subscriptions=set(item.get("subscriptions") or []),
        )


def build_default_websocket_registry(settings: Settings | None = None) -> WebSocketRegistry:
    cfg = settings or get_settings()
    if cfg.websocket_connections_table.strip():
        return DynamoDBWebSocketRegistry.from_settings(cfg)
    if cfg.is_development:
        return InMemoryWebSocketRegistry()
    raise ValueError(
        "WebSocket registry table is not configured. Set STOCVEST_WS_CONNECTIONS_TABLE in non-development environments."
    )


_REGISTRY = build_default_websocket_registry()


def websocket_connect_handler(
    event: LambdaEvent,
    context: LambdaContext,
    registry: WebSocketRegistry = _REGISTRY,
) -> dict[str, Any]:
    _ = context
    connection_id = _connection_id(event)
    if not connection_id:
        return bad_request("Missing websocket connection id.")
    user_id = _user_id(event)
    registry.connect(connection_id, user_id=user_id)
    return ok({"connected": True, "connection_id": connection_id, "user_id": user_id})


def websocket_disconnect_handler(
    event: LambdaEvent,
    context: LambdaContext,
    registry: WebSocketRegistry = _REGISTRY,
) -> dict[str, Any]:
    _ = context
    connection_id = _connection_id(event)
    if not connection_id:
        return bad_request("Missing websocket connection id.")
    registry.disconnect(connection_id)
    index_unsubscribe_scanner_updates(connection_id)
    return ok({"disconnected": True, "connection_id": connection_id})


def websocket_default_handler(
    event: LambdaEvent,
    context: LambdaContext,
    registry: WebSocketRegistry = _REGISTRY,
) -> dict[str, Any]:
    _ = context
    connection_id = _connection_id(event)
    if not connection_id:
        return bad_request("Missing websocket connection id.")

    try:
        payload = _parse_body(event)
    except ValueError as exc:
        return bad_request(str(exc))

    action = str(payload.get("action") or "").strip().lower()
    if not action:
        return bad_request("Body field 'action' is required.")

    try:
        if action == "ping":
            return ok({"action": "pong", "connection_id": connection_id})
        if action == "subscribe":
            channel = _channel(payload)
            subscriptions = sorted(registry.subscribe(connection_id, channel))
            if channel == SCANNER_UPDATES_CHANNEL:
                index_subscribe_scanner_updates(connection_id)
            return ok({"subscribed": channel, "subscriptions": subscriptions})
        if action == "unsubscribe":
            channel = _channel(payload)
            subscriptions = sorted(registry.unsubscribe(connection_id, channel))
            if channel == SCANNER_UPDATES_CHANNEL:
                index_unsubscribe_scanner_updates(connection_id)
            return ok({"unsubscribed": channel, "subscriptions": subscriptions})
        if action == "list_subscriptions":
            subscriptions = sorted(registry.subscriptions(connection_id))
            return ok({"subscriptions": subscriptions})
        return bad_request(f"Unsupported websocket action: {action}")
    except KeyError as exc:
        return bad_request(str(exc))
    except Exception as exc:
        return internal_error(str(exc))


def _parse_body(event: LambdaEvent) -> dict[str, Any]:
    body = event.get("body")
    if body is None or body == "":
        return {}
    if isinstance(body, dict):
        return body
    if not isinstance(body, str):
        raise ValueError("Expected body to be a JSON object or string.")
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as exc:
        raise ValueError("Request body must be valid JSON.") from exc
    if not isinstance(parsed, dict):
        raise ValueError("Request body must be a JSON object.")
    return parsed


def _connection_id(event: LambdaEvent) -> str | None:
    request_context = event.get("requestContext") or {}
    if not isinstance(request_context, dict):
        return None
    connection_id = request_context.get("connectionId")
    if connection_id is None:
        return None
    text = str(connection_id).strip()
    return text or None


def _user_id(event: LambdaEvent) -> str | None:
    request_context = event.get("requestContext") or {}
    if not isinstance(request_context, dict):
        return None
    authorizer = request_context.get("authorizer") or {}
    if not isinstance(authorizer, dict):
        return None
    claims = authorizer.get("claims") or {}
    if not isinstance(claims, dict):
        return None
    sub = claims.get("sub")
    if sub is None:
        return None
    text = str(sub).strip()
    return text or None


def _channel(payload: dict[str, Any]) -> str:
    channel = str(payload.get("channel") or "").strip()
    if not channel:
        raise ValueError("Body field 'channel' is required for this action.")
    return channel

