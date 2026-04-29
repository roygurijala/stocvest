"""Construct broker adapters by kind (mock, ibkr, etrade)."""

from __future__ import annotations

from typing import Literal

from stocvest.brokers.adapter import BrokerAdapter
from stocvest.brokers.etrade_adapter import ETradeBrokerAdapter
from stocvest.brokers.ibkr_adapter import IBKRBrokerAdapter
from stocvest.brokers.mock_adapter import MockBrokerAdapter

BrokerKind = Literal["mock", "ibkr", "etrade"]


class BrokerAdapterFactory:
    @staticmethod
    def create(kind: BrokerKind) -> BrokerAdapter:
        if kind == "mock":
            return MockBrokerAdapter()
        if kind == "ibkr":
            return IBKRBrokerAdapter()
        if kind == "etrade":
            return ETradeBrokerAdapter()
        raise ValueError(f"Unknown broker kind: {kind!r}")
