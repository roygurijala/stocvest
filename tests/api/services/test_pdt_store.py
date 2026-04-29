from __future__ import annotations

from datetime import date

import pytest

from stocvest.api.services.pdt_store import (
    DynamoDBPDTStateStore,
    build_default_pdt_state_store,
)
from stocvest.utils.config import get_settings


class _FakeTable:
    def __init__(self) -> None:
        self.rows: dict[str, dict] = {}

    def get_item(self, *, Key: dict[str, str]) -> dict:
        row = self.rows.get(Key["userId"])
        return {"Item": row} if row else {}

    def put_item(self, *, Item: dict) -> dict:
        self.rows[Item["userId"]] = Item
        return {}


def test_dynamodb_pdt_store_get_save_and_record() -> None:
    store = DynamoDBPDTStateStore(table=_FakeTable())
    state = store.get_state("u1")
    assert state.day_trade_dates == ()
    updated = store.record_day_trade("u1", date(2026, 4, 29))
    assert updated.day_trade_dates == (date(2026, 4, 29),)
    reread = store.get_state("u1")
    assert reread.day_trade_dates == (date(2026, 4, 29),)


def test_build_default_pdt_store_requires_table_outside_development(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("POLYGON_API_KEY", "x")
    monkeypatch.setenv("STOCVEST_ENV", "production")
    monkeypatch.delenv("STOCVEST_PDT_STATE_TABLE", raising=False)
    get_settings.cache_clear()
    with pytest.raises(ValueError, match="STOCVEST_PDT_STATE_TABLE"):
        build_default_pdt_state_store()
