from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock, patch

from stocvest.data.orb_store import ORBRecord, get_orb_record, store_orb_record


def test_store_orb_writes_to_dynamodb() -> None:
    table = MagicMock()
    with patch("stocvest.data.orb_store._ddb_table", return_value=table):
        rec = store_orb_record("aapl", 432.15, 428.90, trade_date=date(2026, 5, 7))
    table.put_item.assert_called_once()
    item = table.put_item.call_args.kwargs["Item"]
    assert item["accountId"] == "ORB#AAPL"
    assert item["setupKey"] == "2026-05-07"
    assert item["orb_high"] == str(rec.orb_high)
    assert item["orb_low"] == str(rec.orb_low)
    assert item["status"] == "complete"
    assert rec.status == "complete"


def test_get_orb_record_returns_record() -> None:
    table = MagicMock()
    table.get_item.return_value = {
        "Item": {
            "orb_high": "432.15",
            "orb_low": "428.90",
            "orb_range_pct": "0.77",
            "computed_at": "10:00:05 ET",
            "status": "complete",
        }
    }
    with patch("stocvest.data.orb_store._ddb_table", return_value=table):
        row = get_orb_record("AAPL", trade_date=date(2026, 5, 7))
    assert row is not None
    assert row.orb_high == 432.15
    assert row.orb_low == 428.90
    assert row.status == "complete"


def test_get_orb_record_returns_none_when_missing() -> None:
    table = MagicMock()
    table.get_item.return_value = {}
    with patch("stocvest.data.orb_store._ddb_table", return_value=table):
        assert get_orb_record("NVDA", trade_date=date(2026, 5, 7)) is None


def test_get_orb_record_returns_none_on_error() -> None:
    table = MagicMock()
    table.get_item.side_effect = RuntimeError("ddb down")
    with patch("stocvest.data.orb_store._ddb_table", return_value=table):
        assert get_orb_record("NVDA", trade_date=date(2026, 5, 7)) is None


def test_orb_record_midpoint() -> None:
    r = ORBRecord(
        trade_date="2026-05-07",
        symbol="X",
        orb_high=432.15,
        orb_low=428.90,
        orb_range_pct=0.77,
        computed_at="10:00 ET",
    )
    assert abs(r.midpoint - 430.525) < 0.01
