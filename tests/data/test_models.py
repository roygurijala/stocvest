from __future__ import annotations

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from stocvest.data.models import (
    AssetType,
    Bar,
    EarningsEvent,
    MarketStatus,
    NewsArticle,
    Newssentiment,
    OptionContract,
    Quote,
    Snapshot,
    Timeframe,
    Trade,
)


@pytest.mark.unit
def test_bar_roundtrip() -> None:
    b = Bar(
        symbol="AAPL",
        timestamp=datetime(2026, 4, 28, 14, 30, tzinfo=timezone.utc),
        timeframe=Timeframe.MIN_1,
        open=100.0,
        high=101.0,
        low=99.5,
        close=100.5,
        volume=1_000_000.0,
        vwap=100.25,
    )
    data = b.model_dump()
    b2 = Bar.model_validate(data)
    assert b2 == b


@pytest.mark.unit
def test_quote_trade_minimal() -> None:
    q = Quote(
        symbol="MSFT",
        timestamp=datetime(2026, 4, 28, 15, 0, tzinfo=timezone.utc),
        bid_price=400.0,
        bid_size=100,
        ask_price=400.05,
        ask_size=200,
    )
    assert q.bid_exchange is None
    t = Trade(
        symbol="MSFT",
        timestamp=datetime(2026, 4, 28, 15, 0, tzinfo=timezone.utc),
        price=400.02,
        size=50,
    )
    assert t.conditions == []


@pytest.mark.unit
def test_snapshot_optional_fields() -> None:
    s = Snapshot(symbol="NVDA")
    assert s.last_trade_price is None
    s2 = Snapshot(
        symbol="NVDA",
        prev_close=100.0,
        pre_market_price=102.0,
        after_hours_price=101.0,
    )
    assert s2.pre_market_price == pytest.approx(102.0)


@pytest.mark.unit
def test_news_article_sentiment_fields() -> None:
    n = NewsArticle(
        article_id="n1",
        published_at=datetime(2026, 4, 28, 12, 0, tzinfo=timezone.utc),
        title="Headline",
        url="https://example.com/a",
        tickers=["AAPL"],
        sentiment=Newssentiment.BULLISH,
        sentiment_score=0.6,
    )
    assert n.sentiment == Newssentiment.BULLISH


@pytest.mark.unit
def test_news_article_requires_url() -> None:
    with pytest.raises(ValidationError):
        NewsArticle(
            article_id="x",
            published_at=datetime(2026, 4, 28, 12, 0, tzinfo=timezone.utc),
            title="t",
        )


@pytest.mark.unit
def test_option_contract() -> None:
    o = OptionContract(
        symbol="AAPL260116C00150000",
        underlying="AAPL",
        expiration=datetime(2026, 1, 16, 21, 0, tzinfo=timezone.utc),
        strike=150.0,
        option_type="call",
        delta=0.55,
    )
    assert o.option_type == "call"


@pytest.mark.unit
def test_market_status() -> None:
    m = MarketStatus(
        market="stocks",
        server_time=datetime(2026, 4, 28, 13, 30, tzinfo=timezone.utc),
        exchanges={"nyse": "open"},
    )
    assert m.exchanges["nyse"] == "open"


@pytest.mark.unit
def test_earnings_event_model() -> None:
    e = EarningsEvent(
        symbol="AAPL",
        company_name="Apple Inc.",
        report_date=datetime(2026, 5, 1, tzinfo=timezone.utc).date(),
        report_time="before_market",
        estimated_eps=1.5,
        actual_eps=1.7,
        surprise_percent=13.3,
    )
    assert e.symbol == "AAPL"


@pytest.mark.unit
def test_timeframe_and_asset_type_enum_values() -> None:
    assert Timeframe.MIN_1.value == "1min"
    assert AssetType.STOCK.value == "stock"
