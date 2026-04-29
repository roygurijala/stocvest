from __future__ import annotations

from datetime import datetime, timezone

import pytest

from stocvest.data.models import NewsArticle, Newssentiment
from stocvest.signals.news_catalyst_detector import NewsCatalystDetector


def article(
    article_id: str,
    title: str,
    *,
    description: str = "",
    source: str | None = "Reuters",
    tickers: list[str] | None = None,
    sentiment: Newssentiment | None = None,
    sentiment_score: float | None = None,
    keywords: list[str] | None = None,
) -> NewsArticle:
    return NewsArticle(
        article_id=article_id,
        published_at=datetime(2026, 4, 28, 8, 0, tzinfo=timezone.utc),
        title=title,
        description=description,
        url=f"https://example.com/{article_id}",
        source=source,
        tickers=["AAPL"] if tickers is None else tickers,
        keywords=keywords or [],
        sentiment=sentiment,
        sentiment_score=sentiment_score,
    )


@pytest.mark.unit
def test_detects_high_strength_earnings_catalyst():
    detector = NewsCatalystDetector(min_score=0.35)
    candidates = detector.detect(
        [
            article(
                "c1",
                "Company posts earnings beat and raises guidance",
                sentiment=Newssentiment.BULLISH,
                sentiment_score=0.85,
                keywords=["earnings", "guidance"],
            )
        ]
    )
    assert len(candidates) == 1
    assert candidates[0].catalyst_type in {"earnings", "guidance"}
    assert candidates[0].direction == "up"
    assert candidates[0].catalyst_score > 0.7


@pytest.mark.unit
def test_ranks_by_catalyst_score_desc():
    detector = NewsCatalystDetector(min_score=0.35)
    candidates = detector.detect(
        [
                article("c2", "Minor business update", sentiment_score=0.4, source="Unknown"),
            article(
                "c3",
                "FDA approval received",
                sentiment=Newssentiment.BULLISH,
                sentiment_score=0.65,
                keywords=["fda", "approval"],
            ),
        ]
    )
    assert len(candidates) == 2
    assert candidates[0].article_id == "c3"
    assert candidates[0].catalyst_score >= candidates[1].catalyst_score


@pytest.mark.unit
def test_ignores_articles_without_tickers():
    detector = NewsCatalystDetector(min_score=0.2)
    candidates = detector.detect(
        [
            article("c4", "Earnings beat", tickers=[], sentiment_score=0.9, keywords=["earnings"]),
        ]
    )
    assert candidates == []


@pytest.mark.unit
def test_direction_down_for_bearish_news():
    detector = NewsCatalystDetector(min_score=0.2)
    candidates = detector.detect(
        [
            article(
                "c5",
                "Company faces investigation",
                sentiment=Newssentiment.BEARISH,
                sentiment_score=-0.7,
                keywords=["investigation"],
            )
        ]
    )
    assert len(candidates) == 1
    assert candidates[0].direction == "down"


@pytest.mark.unit
def test_respects_limit_and_threshold():
    detector = NewsCatalystDetector(min_score=0.5)
    candidates = detector.detect(
        [
            article("c6", "General update", sentiment_score=0.1, source="Unknown"),
            article("c7", "Contract win announced", sentiment_score=0.5, keywords=["contract"]),
            article("c8", "Merger discussion underway", sentiment_score=0.6, keywords=["merger"]),
        ],
        limit=1,
    )
    assert len(candidates) == 1
    assert candidates[0].article_id in {"c7", "c8"}
