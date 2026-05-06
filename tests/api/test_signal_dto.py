from __future__ import annotations

from datetime import datetime, timezone

from stocvest.api.services.signal_dto import (
    parse_article,
    parse_bar,
    parse_catalyst,
    parse_gap_candidate,
    parse_pdt_assessment,
    serialize_catalyst,
    serialize_gap_candidate,
    serialize_intraday_setup,
)
from stocvest.signals import IntradaySetupCandidate


def test_parse_bar_maps_optional_fields() -> None:
    bar = parse_bar(
        {
            "timestamp": "2026-04-28T14:31:00+00:00",
            "timeframe": "1min",
            "open": 100.0,
            "high": 101.0,
            "low": 99.5,
            "close": 100.5,
            "volume": 125000,
            "vwap": 100.3,
            "transactions": 2500,
        },
        "AAPL",
    )
    assert bar.symbol == "AAPL"
    assert bar.vwap == 100.3
    assert bar.transactions == 2500


def test_parse_article_maps_sentiment_enum() -> None:
    article = parse_article(
        {
            "article_id": "a1",
            "published_at": "2026-04-28T11:00:00+00:00",
            "title": "AAPL beats estimates",
            "description": "Revenue guidance raised",
            "url": "https://example.com/1",
            "source": "Reuters",
            "tickers": ["AAPL"],
            "keywords": ["earnings"],
            "sentiment": "bullish",
            "sentiment_score": 0.6,
        }
    )
    assert article.article_id == "a1"
    assert article.sentiment is not None
    assert article.sentiment.value == "bullish"
    assert article.sentiment_score == 0.6


def test_parse_pdt_assessment_defaults_allow_next_trade_true() -> None:
    assessment = parse_pdt_assessment({"day_trades_in_window": 2})
    assert assessment.day_trades_in_window == 2
    assert assessment.allow_next_day_trade is True
    assert assessment.max_non_exempt == 3


def test_parse_gap_candidate_uppercases_symbol() -> None:
    candidate = parse_gap_candidate(
        {
            "symbol": "gap1",
            "prev_close": 100.0,
            "premarket_price": 104.0,
            "gap_percent": 4.0,
            "day_volume": 12000000.0,
            "direction": "up",
            "rank_score": 4.8,
        }
    )
    assert candidate.symbol == "GAP1"
    assert candidate.rank_score == 4.8


def test_parse_catalyst_uppercases_symbol() -> None:
    candidate = parse_catalyst(
        {
            "article_id": "a1",
            "symbol": "gap1",
            "title": "Strong earnings beat",
            "catalyst_type": "earnings",
            "direction": "up",
            "catalyst_score": 0.8,
            "sentiment_score": 0.6,
            "source": "Reuters",
        }
    )
    assert candidate.symbol == "GAP1"
    assert candidate.source == "Reuters"


def test_serialize_intraday_setup_returns_expected_shape() -> None:
    setup = IntradaySetupCandidate(
        symbol="AAPL",
        direction="long",
        score=0.74,
        triggers=["or_breakout_up", "vwap_reclaim"],
        last_price=101.2,
        vwap=100.6,
        ema9=100.8,
        timestamp_iso=datetime(2026, 4, 28, 14, 45, tzinfo=timezone.utc).isoformat(),
        company_name="Apple Inc.",
    )
    payload = serialize_intraday_setup(setup)
    assert payload["symbol"] == "AAPL"
    assert payload["direction"] == "long"
    assert payload["triggers"] == ["or_breakout_up", "vwap_reclaim"]
    assert payload["company_name"] == "Apple Inc."
    assert payload["last_price"] == 101.2
    assert "confluence_score" in payload
    assert "is_confluence_alert" in payload


def test_serialize_intraday_setup_prefers_snapshot_last_trade_price() -> None:
    setup = IntradaySetupCandidate(
        symbol="AAPL",
        direction="long",
        score=0.74,
        triggers=["or_breakout_up", "vwap_reclaim"],
        last_price=0.41,
        vwap=100.6,
        ema9=100.8,
        timestamp_iso=datetime(2026, 4, 28, 14, 45, tzinfo=timezone.utc).isoformat(),
        company_name="Apple Inc.",
    )
    payload = serialize_intraday_setup(setup, snapshot={"last_trade_price": 185.32})
    assert payload["last_price"] == 185.32


def test_serialize_gap_candidate_returns_expected_shape() -> None:
    candidate = parse_gap_candidate(
        {
            "symbol": "AAPL",
            "prev_close": 100.0,
            "premarket_price": 104.0,
            "gap_percent": 4.0,
            "day_volume": 12000000.0,
            "direction": "up",
            "rank_score": 4.8,
        }
    )
    payload = serialize_gap_candidate(candidate)
    assert payload["symbol"] == "AAPL"
    assert payload["gap_percent"] == 4.0


def test_serialize_catalyst_returns_expected_shape() -> None:
    candidate = parse_catalyst(
        {
            "article_id": "a1",
            "symbol": "AAPL",
            "title": "Strong earnings beat",
            "catalyst_type": "earnings",
            "direction": "up",
            "catalyst_score": 0.8,
            "sentiment_score": 0.6,
            "source": "Reuters",
        }
    )
    payload = serialize_catalyst(candidate)
    assert payload["article_id"] == "a1"
    assert payload["catalyst_type"] == "earnings"
