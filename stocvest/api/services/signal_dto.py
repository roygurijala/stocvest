"""Shared DTO parsing/serialization for signal and scanner handlers."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from stocvest.data.models import Bar, NewsArticle, Newssentiment, Timeframe
from stocvest.signals import (
    IntradaySetupCandidate,
    NewsCatalystCandidate,
    PDTAssessment,
    PremarketGapCandidate,
)


def parse_bar(item: dict[str, Any], symbol: str) -> Bar:
    timeframe_raw = str(item.get("timeframe") or Timeframe.MIN_1.value)
    return Bar(
        symbol=symbol,
        timestamp=datetime.fromisoformat(str(item["timestamp"])),
        timeframe=Timeframe(timeframe_raw),
        open=float(item["open"]),
        high=float(item["high"]),
        low=float(item["low"]),
        close=float(item["close"]),
        volume=float(item["volume"]),
        vwap=float(item["vwap"]) if item.get("vwap") is not None else None,
        transactions=int(item["transactions"]) if item.get("transactions") is not None else None,
    )


def parse_article(item: dict[str, Any]) -> NewsArticle:
    sentiment_raw = item.get("sentiment")
    sentiment = Newssentiment(str(sentiment_raw)) if sentiment_raw is not None else None
    return NewsArticle(
        article_id=str(item["article_id"]),
        published_at=datetime.fromisoformat(str(item["published_at"])),
        title=str(item["title"]),
        description=str(item["description"]) if item.get("description") is not None else None,
        url=str(item["url"]),
        source=str(item["source"]) if item.get("source") is not None else None,
        tickers=[str(x) for x in item.get("tickers", [])],
        keywords=[str(x) for x in item.get("keywords", [])],
        sentiment=sentiment,
        sentiment_score=float(item["sentiment_score"]) if item.get("sentiment_score") is not None else None,
    )


def parse_pdt_assessment(item: dict[str, Any]) -> PDTAssessment:
    return PDTAssessment(
        pdt_exempt=bool(item.get("pdt_exempt", False)),
        day_trades_in_window=int(item["day_trades_in_window"]),
        max_non_exempt=int(item.get("max_non_exempt", 3)),
        rolling_business_days=int(item.get("rolling_business_days", 5)),
        allow_next_day_trade=bool(item.get("allow_next_day_trade", True)),
        warn_near_limit=bool(item.get("warn_near_limit", False)),
        at_limit=bool(item.get("at_limit", False)),
    )


def parse_gap_candidate(item: dict[str, Any]) -> PremarketGapCandidate:
    return PremarketGapCandidate(
        symbol=str(item["symbol"]).upper(),
        prev_close=float(item["prev_close"]),
        premarket_price=float(item["premarket_price"]),
        gap_percent=float(item["gap_percent"]),
        day_volume=float(item["day_volume"]),
        direction=str(item["direction"]),
        rank_score=float(item["rank_score"]),
    )


def parse_catalyst(item: dict[str, Any]) -> NewsCatalystCandidate:
    return NewsCatalystCandidate(
        article_id=str(item["article_id"]),
        symbol=str(item["symbol"]).upper(),
        title=str(item["title"]),
        catalyst_type=str(item["catalyst_type"]),
        direction=str(item["direction"]),
        catalyst_score=float(item["catalyst_score"]),
        sentiment_score=float(item["sentiment_score"]),
        source=str(item["source"]) if item.get("source") is not None else None,
    )


def serialize_intraday_setup(candidate: IntradaySetupCandidate) -> dict[str, Any]:
    return {
        "symbol": candidate.symbol,
        "direction": candidate.direction,
        "score": candidate.score,
        "triggers": candidate.triggers,
        "last_price": candidate.last_price,
        "vwap": candidate.vwap,
        "ema9": candidate.ema9,
        "timestamp_iso": candidate.timestamp_iso,
    }


def serialize_gap_candidate(candidate: PremarketGapCandidate) -> dict[str, Any]:
    return {
        "symbol": candidate.symbol,
        "prev_close": candidate.prev_close,
        "premarket_price": candidate.premarket_price,
        "gap_percent": candidate.gap_percent,
        "day_volume": candidate.day_volume,
        "direction": candidate.direction,
        "rank_score": candidate.rank_score,
    }


def serialize_catalyst(candidate: NewsCatalystCandidate) -> dict[str, Any]:
    return {
        "article_id": candidate.article_id,
        "symbol": candidate.symbol,
        "title": candidate.title,
        "catalyst_type": candidate.catalyst_type,
        "direction": candidate.direction,
        "catalyst_score": candidate.catalyst_score,
        "sentiment_score": candidate.sentiment_score,
        "source": candidate.source,
    }

