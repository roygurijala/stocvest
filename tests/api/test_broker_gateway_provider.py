from __future__ import annotations

import pytest

from stocvest.api.broker_gateway_provider import BrokerGatewayProvider
from stocvest.brokers.exceptions import BrokerUnavailableError
from stocvest.utils.config import Settings


def test_provider_resolves_ibkr_gateway_from_binding() -> None:
    settings = Settings.model_validate(
        {
            "polygon_api_key": "x",
            "ibkr_gateway_binding": "ibkr.live",
            "etrade_gateway_binding": "etrade.live",
            "etrade_consumer_key": "ck",
            "etrade_consumer_secret": "cs",
        }
    )
    provider = BrokerGatewayProvider(settings=settings)
    gw = object()
    provider.register("ibkr.live", gw)

    cfg = provider.build_connect_config("ibkr")
    assert cfg["gateway"] is gw


def test_provider_raises_when_binding_not_registered() -> None:
    settings = Settings.model_validate(
        {"polygon_api_key": "x", "ibkr_gateway_binding": "ibkr.live"}
    )
    provider = BrokerGatewayProvider(settings=settings)
    with pytest.raises(BrokerUnavailableError, match="not registered"):
        provider.build_connect_config("ibkr")


def test_provider_builds_etrade_connect_config_with_credentials() -> None:
    settings = Settings.model_validate(
        {
            "polygon_api_key": "x",
            "etrade_gateway_binding": "etrade.live",
            "etrade_consumer_key": "ck",
            "etrade_consumer_secret": "cs",
            "sandbox_integration_enabled": True,
        }
    )
    provider = BrokerGatewayProvider(settings=settings)
    gw = object()
    provider.register("etrade.live", gw)

    cfg = provider.build_connect_config("etrade")
    assert cfg["gateway"] is gw
    assert cfg["consumer_key"] == "ck"
    assert cfg["consumer_secret"] == "cs"
    assert cfg["sandbox"] is True

