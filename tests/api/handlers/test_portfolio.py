from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from stocvest.api.handlers.portfolio import (
    portfolio_allocation_handler,
    portfolio_holdings_handler,
    portfolio_summary_handler,
)
from stocvest.brokers.models import BrokerPosition


@dataclass
class _FakeAdapter:
    async def connect(self, config: dict[str, Any]) -> None:
        _ = config

    async def disconnect(self) -> None:
        return None

    async def get_positions(self, account_id: str) -> list[BrokerPosition]:
        _ = account_id
        return [
            BrokerPosition(symbol="AAPL", quantity=10, avg_cost=150),
            BrokerPosition(symbol="MSFT", quantity=-2, avg_cost=400),
        ]


class _FakeFactory:
    @staticmethod
    def create(kind: str) -> _FakeAdapter:
        assert kind == "mock"
        return _FakeAdapter()


def test_portfolio_holdings_handler_returns_rows() -> None:
    event = {
        "queryStringParameters": {"broker": "mock", "account_id": "A1"},
        "body": json.dumps({"prices": {"AAPL": 175, "MSFT": 390}}),
    }
    response = portfolio_holdings_handler(event, {}, factory=_FakeFactory)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert len(body["holdings"]) == 2
    assert body["holdings"][0]["symbol"] == "AAPL"


def test_portfolio_summary_handler_calculates_exposure() -> None:
    event = {
        "queryStringParameters": {"broker": "mock", "account_id": "A1"},
        "body": json.dumps({"prices": {"AAPL": 175, "MSFT": 390}}),
    }
    response = portfolio_summary_handler(event, {}, factory=_FakeFactory)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["positions_count"] == 2
    assert body["gross_exposure"] == 2530.0
    assert body["net_exposure"] == 970.0


def test_portfolio_allocation_handler_returns_weighted_rows() -> None:
    event = {
        "queryStringParameters": {"broker": "mock", "account_id": "A1"},
        "body": json.dumps({"prices": {"AAPL": 175, "MSFT": 390}}),
    }
    response = portfolio_allocation_handler(event, {}, factory=_FakeFactory)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert len(body["allocation"]) == 2
    assert body["allocation"][0]["symbol"] == "AAPL"
    assert body["allocation"][0]["weight"] > body["allocation"][1]["weight"]


def test_portfolio_handlers_require_broker_account() -> None:
    event = {"queryStringParameters": {"broker": "mock"}}
    response = portfolio_summary_handler(event, {}, factory=_FakeFactory)
    assert response["statusCode"] == 400

