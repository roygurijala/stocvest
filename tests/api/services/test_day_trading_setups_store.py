from __future__ import annotations

import json

import pytest

from stocvest.api.services.day_trading_setups_store import (
    SCANNER_SYSTEM_ACCOUNT_ID,
    InMemoryDayTradingSetupsStore,
    get_day_trading_setups_store,
    reset_day_trading_setups_store_for_tests,
)


def test_in_memory_store_persists_scan_run(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_ENV", "development")
    monkeypatch.delenv("DYNAMODB_DAY_TRADING_SETUPS", raising=False)
    reset_day_trading_setups_store_for_tests()
    store = get_day_trading_setups_store()
    assert isinstance(store, InMemoryDayTradingSetupsStore)
    store.put_scan_run(
        setup_key="premarket#2026-04-29T12:00:00+00:00",
        scan_type="premarket",
        document={"scan_type": "premarket", "data": {"gaps": []}},
    )
    row = store.rows[(SCANNER_SYSTEM_ACCOUNT_ID, "premarket#2026-04-29T12:00:00+00:00")]
    assert json.loads(row["document"])["scan_type"] == "premarket"
