"""Sector daily cache DynamoDB fallback."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from stocvest.workers.sector_daily_cache import (
    DailyReturn,
    _read_sector_daily_dynamo,
    _write_sector_daily_dynamo,
    get_cached_sector_returns,
)


def test_write_and_read_sector_daily_dynamo_roundtrip(monkeypatch) -> None:
    table = MagicMock()
    stored: dict = {}

    def _put_item(*, Item):  # noqa: N803
        stored["item"] = Item

    def _get_item(*, Key):  # noqa: N803
        if stored.get("item", {}).get("symbol") == Key.get("symbol"):
            return {"Item": stored["item"]}
        return {}

    table.put_item.side_effect = _put_item
    table.get_item.side_effect = _get_item
    resource = MagicMock()
    resource.Table.return_value = table

    class _Settings:
        dynamodb_sector_cache_table = "SectorCache"
        aws_region = "us-east-1"

    returns = [DailyReturn("2026-06-09", 1.0, 0.5, 0.5, True, 1.0)]
    with patch("boto3.resource", return_value=resource):
        with patch("stocvest.workers.sector_daily_cache.get_settings", lambda: _Settings()):
            with patch("stocvest.workers.sector_daily_cache.time.time", return_value=1_000_000):
                _write_sector_daily_dynamo("XLK", returns)
                out = _read_sector_daily_dynamo("XLK")
    assert out is not None
    assert len(out) == 1
    assert out[0].relative == 0.5


def test_get_cached_sector_returns_falls_back_to_dynamo(monkeypatch) -> None:
    returns = [DailyReturn("2026-06-09", -1.0, 0.0, -1.0, False, 1.0)]
    monkeypatch.setattr("stocvest.workers.sector_daily_cache.get_sync_redis", lambda: None)
    monkeypatch.setattr(
        "stocvest.workers.sector_daily_cache._read_sector_daily_dynamo",
        lambda _etf: returns,
    )
    out = get_cached_sector_returns("XLK")
    assert out == returns
