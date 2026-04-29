from __future__ import annotations

import pytest

from stocvest.brokers import (
    BrokerAdapterFactory,
    BrokerUnavailableError,
    ETradeBrokerAdapter,
    IBKRBrokerAdapter,
    MockBrokerAdapter,
)


@pytest.mark.unit
def test_factory_creates_mock() -> None:
    a = BrokerAdapterFactory.create("mock")
    assert isinstance(a, MockBrokerAdapter)


@pytest.mark.unit
def test_factory_creates_stub_brokers() -> None:
    assert isinstance(BrokerAdapterFactory.create("ibkr"), IBKRBrokerAdapter)
    assert isinstance(BrokerAdapterFactory.create("etrade"), ETradeBrokerAdapter)


@pytest.mark.unit
async def test_ibkr_requires_gateway_when_connecting() -> None:
    a = BrokerAdapterFactory.create("ibkr")
    with pytest.raises(BrokerUnavailableError, match="gateway"):
        await a.connect({})


@pytest.mark.unit
async def test_etrade_requires_gateway_when_connecting() -> None:
    a = BrokerAdapterFactory.create("etrade")
    with pytest.raises(BrokerUnavailableError, match="gateway"):
        await a.connect({})


@pytest.mark.unit
def test_factory_unknown_kind() -> None:
    with pytest.raises(ValueError, match="Unknown"):
        BrokerAdapterFactory.create("coinbase")  # type: ignore[arg-type]
