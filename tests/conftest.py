"""Pytest hooks — keep Redis optional and isolated in unit tests."""

from __future__ import annotations

import sys

# Windows + Python 3.14: botocore's user-agent builder calls platform.system() which
# can trigger WMI from worker threads and print "fatal exception: access violation"
# to stderr. Prime platform.uname()'s process-global cache on the main thread first.
if sys.platform == "win32":
    import platform

    try:
        platform.uname()
    except Exception:
        pass

import pytest

from stocvest.api.services.day_trading_setups_store import reset_day_trading_setups_store_for_tests
from stocvest.api.services.user_profile_store import reset_user_profile_store_for_tests
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
    monkeypatch.setenv("DYNAMODB_USERS_TABLE", "")
    get_settings.cache_clear()
    reset_user_profile_store_for_tests()
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


def tradeable_composite_evidence(*, mode: str = "day", entry: float = 102.2) -> dict:
    """Minimal composite body that passes desk geometry tradeability gates."""
    stop = entry - 4.0
    t1 = entry + 6.0 if mode == "day" else entry + 10.0
    t2 = entry + 10.0 if mode == "day" else entry + 15.0
    return {
        "status": "active",
        "verdict": "bullish",
        "signal_summary": "bullish",
        "last_trade_price": entry,
        "reference_stop_level": stop,
        "reference_target_1": t1,
        "reference_target_2": t2,
        "entry_zone_quality": "clean",
    }


def patch_tradeable_geometry_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    import stocvest.data.dashboard_cache as dc

    def _read(key: str):
        if not isinstance(key, str) or not key.startswith("stocvest:evidence:"):
            return None
        parts = key.split(":")
        if len(parts) < 5:
            return None
        mode = parts[-2]
        return {"data": tradeable_composite_evidence(mode=mode)}

    monkeypatch.setattr(dc, "read_dashboard_cache", _read)


@pytest.fixture
def tradeable_geometry_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    patch_tradeable_geometry_cache(monkeypatch)
