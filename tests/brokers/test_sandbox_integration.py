from __future__ import annotations

import os

import pytest

from stocvest.brokers import (
    BrokerAdapterFactory,
    BrokerHealth,
    ETradeBrokerAdapter,
    IBKRBrokerAdapter,
)


def _integration_enabled() -> bool:
    return os.getenv("STOCVEST_ENABLE_SANDBOX_INTEGRATION") == "1"


@pytest.mark.integration
async def test_ibkr_sandbox_health_check_harness() -> None:
    """
    Live sandbox harness.

    Requires:
    - STOCVEST_ENABLE_SANDBOX_INTEGRATION=1
    - a real IBKR gateway object supplied by test env/plugin.
    """
    if not _integration_enabled():
        pytest.skip("Set STOCVEST_ENABLE_SANDBOX_INTEGRATION=1 to run sandbox tests.")

    gateway = os.getenv("STOCVEST_IBKR_GATEWAY")
    if not gateway:
        pytest.skip("IBKR gateway binding not configured in test environment.")

    # Harness contract only. Real gateway plumbing is environment-specific.
    adapter = BrokerAdapterFactory.create("ibkr")
    assert isinstance(adapter, IBKRBrokerAdapter)
    assert isinstance(await adapter.health_check(), BrokerHealth)


@pytest.mark.integration
async def test_etrade_sandbox_health_check_harness() -> None:
    """
    Live sandbox harness.

    Requires:
    - STOCVEST_ENABLE_SANDBOX_INTEGRATION=1
    - a real E*TRADE gateway object supplied by test env/plugin.
    """
    if not _integration_enabled():
        pytest.skip("Set STOCVEST_ENABLE_SANDBOX_INTEGRATION=1 to run sandbox tests.")

    gateway = os.getenv("STOCVEST_ETRADE_GATEWAY")
    if not gateway:
        pytest.skip("E*TRADE gateway binding not configured in test environment.")

    adapter = BrokerAdapterFactory.create("etrade")
    assert isinstance(adapter, ETradeBrokerAdapter)
    assert isinstance(await adapter.health_check(), BrokerHealth)

