from __future__ import annotations

from datetime import datetime, timezone

from stocvest.api.services.polygon_insight_sentiment import article_sentiment_score_for_symbol
from stocvest.config.signal_parameters import NewsParameters
from stocvest.signals.news_analyzer import NewsAnalyzer


def _comparison_article() -> dict:
    return {
        "title": "Better Buy: Cognex (CGNX) vs. Aeva Technologies (AEVA)",
        "description": "CGNX offers durable profits while AEVA remains speculative.",
        "tickers": ["CGNX", "AEVA"],
        "published_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "publisher": {"name": "The Motley Fool"},
        "insights": [
            {"ticker": "AEVA", "sentiment": "negative"},
            {"ticker": "CGNX", "sentiment": "positive"},
        ],
    }


def test_per_ticker_insight_sentiment() -> None:
    article = _comparison_article()
    assert article_sentiment_score_for_symbol(article, "CGNX") == 1.0
    assert article_sentiment_score_for_symbol(article, "AEVA") == -1.0


def test_reversed_insight_order_still_resolves_per_symbol() -> None:
    article = _comparison_article()
    article["insights"] = list(reversed(article["insights"]))  # type: ignore[index]
    assert article_sentiment_score_for_symbol(article, "CGNX") == 1.0
    assert article_sentiment_score_for_symbol(article, "AEVA") == -1.0


def test_multi_ticker_without_matching_insight_abstains() -> None:
    article = {
        "title": "Sector roundup",
        "tickers": ["CGNX", "AEVA"],
        "published_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "publisher": {"name": "Reuters"},
        "insights": [{"ticker": "AEVA", "sentiment": "negative"}],
    }
    assert article_sentiment_score_for_symbol(article, "CGNX") == 0.0


def test_news_analyzer_scores_cgnx_bullish_on_comparison_pick() -> None:
    params = NewsParameters()
    result = NewsAnalyzer().analyze("CGNX", [_comparison_article()], params)
    assert result.headline_sentiment is not None and result.headline_sentiment > 0
    assert result.score is not None and result.score >= params.bullish_threshold
    assert result.verdict == "bullish"
