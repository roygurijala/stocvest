"""Pytest hooks — keep Redis optional and isolated in unit tests."""

from __future__ import annotations

import pytest

from stocvest.api.services.day_trading_setups_store import reset_day_trading_setups_store_for_tests
from stocvest.api.services.ws_connection_index import reset_ws_subscriber_index_for_tests
from stocvest.utils.redis_client import reset_redis_client_for_tests


@pytest.fixture(autouse=True)
def _redis_test_isolation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_DISABLE_REDIS", "1")
    reset_redis_client_for_tests()
    reset_day_trading_setups_store_for_tests()
    reset_ws_subscriber_index_for_tests()
    yield
    reset_redis_client_for_tests()
    reset_day_trading_setups_store_for_tests()
    reset_ws_subscriber_index_for_tests()
