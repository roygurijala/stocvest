"""Polygon ticker reference parsing."""

from __future__ import annotations

from stocvest.data.ticker_reference import parse_polygon_ticker_details


def test_parse_polygon_ticker_details() -> None:
    raw = {
        "ticker": "AAPL",
        "active": True,
        "market_cap": 3_000_000_000_000,
        "type": "CS",
        "locale": "us",
        "country_code": "US",
        "primary_exchange": "XNAS",
        "list_date": "1980-12-12",
        "name": "Apple Inc.",
    }
    ref = parse_polygon_ticker_details(raw)
    assert ref is not None
    assert ref.symbol == "AAPL"
    assert ref.market_cap == 3_000_000_000_000
    assert ref.is_adr() is False


def test_parse_adr_type() -> None:
    raw = {"ticker": "BABA", "type": "ADRC", "market_cap": 200_000_000_000}
    ref = parse_polygon_ticker_details(raw)
    assert ref is not None
    assert ref.is_adr() is True
