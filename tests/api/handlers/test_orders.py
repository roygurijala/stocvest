from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import pytest

import stocvest.api.services.journal_order_hooks as journal_order_hooks_mod
from stocvest.api.handlers.orders import orders_submit_handler, orders_validate_handler
from stocvest.api.services.journal_store import InMemoryJournalStore
from stocvest.signals.trade_journal import TradeJournal
from stocvest.brokers.models import (
    BrokerAccount,
    BrokerHealth,
    BrokerPosition,
    OrderAck,
    OrderLifecycleStatus,
    OrderSide,
    OrderStatus,
    PlaceOrderRequest,
)
from stocvest.data.models import TradingMode
from stocvest.api.services import user_profile_store as ups_mod


@dataclass
class _FakeAdapter:
    kind: str = "mock"

    async def connect(self, config: dict[str, Any]) -> None:
        _ = config

    async def disconnect(self) -> None:
        return None

    async def health_check(self) -> BrokerHealth:
        return BrokerHealth(ok=True)

    async def list_accounts(self) -> list[BrokerAccount]:
        return [BrokerAccount(account_id="A1", display_name="Paper")]

    async def get_positions(self, account_id: str) -> list[BrokerPosition]:
        return []

    async def place_order(self, account_id: str, request: PlaceOrderRequest) -> OrderAck:
        return OrderAck(
            client_order_id=request.client_order_id,
            broker_order_id="B-1",
            average_fill_price=100.0,
            quantity_filled=float(request.quantity),
        )

    async def get_order(self, account_id: str, client_order_id: str) -> OrderStatus:
        return OrderStatus(
            client_order_id=client_order_id,
            broker_order_id="B-1",
            status=OrderLifecycleStatus.FILLED,
            symbol="AAPL",
            side=OrderSide.BUY,
            quantity_ordered=1.0,
            quantity_filled=1.0,
            average_fill_price=100.0,
        )

    async def cancel_order(self, account_id: str, client_order_id: str) -> None:
        _ = account_id, client_order_id


class _RecordingFactory:
    last_kind: str | None = None

    @classmethod
    def create(cls, kind: str) -> _FakeAdapter:
        cls.last_kind = kind
        return _FakeAdapter(kind=kind)


class _NoopGatewayProvider:
    @staticmethod
    def build_connect_config(broker_kind: str) -> dict[str, Any]:
        _ = broker_kind
        return {}


class _FakePolygonCtx:
    def __init__(self) -> None:
        self._nyse = "open"

    async def get_market_status(self) -> Any:
        from datetime import datetime, timezone

        from stocvest.data.models import MarketStatus

        return MarketStatus(
            market="stocks",
            server_time=datetime.now(tz=timezone.utc),
            exchanges={"NYSE": self._nyse},
            currencies={},
        )

    async def get_ticker_details(self, symbol: str) -> dict[str, Any]:
        return {"type": "CS", "ticker": symbol}

    async def get_snapshot(self, symbol: str) -> Any:
        from stocvest.data.models import Snapshot

        return Snapshot(symbol=symbol, last_quote_bid=100.0, last_quote_ask=100.2, last_trade_price=100.1)


class _PolygonStub:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        _ = args, kwargs

    async def __aenter__(self) -> _FakePolygonCtx:
        return _FakePolygonCtx()

    async def __aexit__(self, *a: object) -> None:
        return None


def test_live_mode_requires_confirmation_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    _RecordingFactory.last_kind = None
    event = {
        "requestContext": {"authorizer": {"jwt": {"claims": {"sub": "user-1"}}}},
        "body": json.dumps(
            {
                "symbol": "AAPL",
                "side": "buy",
                "quantity": 1,
                "order_type": "market",
                "account_id": "A1",
                "broker": "mock",
                "confirmed": False,
            }
        ),
    }
    resp = orders_submit_handler(event, {}, factory=_RecordingFactory, gateway_provider=_NoopGatewayProvider())
    assert resp["statusCode"] == 400


def test_paper_mode_routes_to_mock(monkeypatch: pytest.MonkeyPatch) -> None:
    _RecordingFactory.last_kind = None
    monkeypatch.setattr(
        journal_order_hooks_mod,
        "get_trade_journal_store",
        lambda: InMemoryJournalStore(TradeJournal()),
    )
    store = ups_mod.InMemoryUserProfileStore()
    store.set_trading_mode("user-1", TradingMode.PAPER)
    monkeypatch.setattr(ups_mod, "get_user_profile_store", lambda: store)

    monkeypatch.setattr("stocvest.api.handlers.orders.PolygonClient", _PolygonStub)

    event = {
        "requestContext": {"authorizer": {"jwt": {"claims": {"sub": "user-1"}}}},
        "body": json.dumps(
            {
                "symbol": "AAPL",
                "side": "buy",
                "quantity": 1,
                "order_type": "market",
                "account_id": "A1",
                "broker": "etrade",
                "confirmed": True,
                "is_day_trade": False,
            }
        ),
    }
    resp = orders_submit_handler(event, {}, factory=_RecordingFactory, gateway_provider=_NoopGatewayProvider())
    assert resp["statusCode"] == 200
    assert _RecordingFactory.last_kind == "mock"


def test_validate_endpoint_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    store = ups_mod.InMemoryUserProfileStore()
    monkeypatch.setattr(ups_mod, "get_user_profile_store", lambda: store)

    monkeypatch.setattr("stocvest.api.handlers.orders.PolygonClient", _PolygonStub)

    event = {
        "requestContext": {"authorizer": {"jwt": {"claims": {"sub": "user-1"}}}},
        "body": json.dumps(
            {
                "symbol": "AAPL",
                "side": "buy",
                "quantity": 1,
                "order_type": "market",
                "account_id": "A1",
                "broker": "mock",
                "is_day_trade": False,
            }
        ),
    }
    resp = orders_validate_handler(event, {}, gateway_provider=_NoopGatewayProvider())
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["is_valid"] is True
