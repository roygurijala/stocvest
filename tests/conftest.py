"""Pytest hooks — keep Redis optional and isolated in unit tests."""

from __future__ import annotations

import pytest

from stocvest.api.services.day_trading_setups_store import reset_day_trading_setups_store_for_tests
from stocvest.api.services.ws_connection_index import reset_ws_subscriber_index_for_tests
from stocvest.data.alert_store import reset_alert_stores_for_tests
from stocvest.data.watchlist_store import reset_watchlist_stores_for_tests
from stocvest.services.alert_trigger import reset_alert_trigger_for_tests
from stocvest.utils.config import get_settings
from stocvest.utils.redis_client import reset_redis_client_for_tests


@pytest.fixture(autouse=True)
def _redis_test_isolation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_DISABLE_REDIS", "1")
    monkeypatch.setenv("DYNAMODB_WATCHLISTS_TABLE", "")
    monkeypatch.setenv("DYNAMODB_ALERTS", "")
    get_settings.cache_clear()
    reset_redis_client_for_tests()
    reset_day_trading_setups_store_for_tests()
    reset_ws_subscriber_index_for_tests()
    reset_watchlist_stores_for_tests()
    reset_alert_stores_for_tests()
    reset_alert_trigger_for_tests()
    yield
    reset_redis_client_for_tests()
    reset_day_trading_setups_store_for_tests()
    reset_ws_subscriber_index_for_tests()
    reset_watchlist_stores_for_tests()
    reset_alert_stores_for_tests()
    reset_alert_trigger_for_tests()
    get_settings.cache_clear()
