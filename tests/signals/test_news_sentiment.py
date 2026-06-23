from __future__ import annotations

from datetime import datetime, timezone

import pytest
import respx
from httpx import Response

from stocvest.data.models import NewsArticle, Newssentiment
from stocvest.signals.news_sentiment import ANTHROPIC_API_URL, NewsSentimentScorer
from stocvest.utils.config import get_settings


def make_article(article_id: str = "n-1") -> NewsArticle:
    return NewsArticle(
        article_id=article_id,
        published_at=datetime(2026, 4, 28, 14, 30, tzinfo=timezone.utc),
        title="Company beats expectations with strong guidance",
        description="Revenue and margins improved with optimistic forward outlook.",
        url="https://example.com/news/1",
        source="ExampleWire",
        tickers=["AAPL"],
        keywords=["earnings"],
    )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_score_article_parses_claude_json(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("POLYGON_API_KEY", "polygon-test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-test")
    get_settings.cache_clear()

    scorer = NewsSentimentScorer()
    article = make_article()

    with respx.mock(assert_all_called=True) as router:
        router.post(ANTHROPIC_API_URL).mock(
            return_value=Response(
                200,
                json={
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                '{"sentiment":"bullish","score":0.78,'
                                '"confidence":0.84,"rationale":"Strong beat and guidance."}'
                            ),
                        }
                    ]
                },
            )
        )
        result = await scorer.score_article(article)

    assert result.sentiment == Newssentiment.BULLISH
    assert result.score == pytest.approx(0.78)
    assert result.confidence == pytest.approx(0.84)
    # relevance/impact omitted by the model → backward-compatible 1.0 defaults.
    assert result.relevance == pytest.approx(1.0)
    assert result.impact == pytest.approx(1.0)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_score_article_parses_relevance_and_impact(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("POLYGON_API_KEY", "polygon-test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-test")
    get_settings.cache_clear()

    scorer = NewsSentimentScorer()
    article = make_article()

    with respx.mock(assert_all_called=True) as router:
        router.post(ANTHROPIC_API_URL).mock(
            return_value=Response(
                200,
                json={
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                '{"sentiment":"bullish","score":0.6,"confidence":0.7,'
                                '"relevance":0.95,"impact":0.4,"rationale":"On-topic but soft catalyst."}'
                            ),
                        }
                    ]
                },
            )
        )
        result = await scorer.score_article(article)

    assert result.relevance == pytest.approx(0.95)
    assert result.impact == pytest.approx(0.4)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_score_article_requires_api_key(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("POLYGON_API_KEY", "polygon-test")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    get_settings.cache_clear()

    scorer = NewsSentimentScorer()
    article = make_article()

    with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
        await scorer.score_article(article)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_score_articles_falls_back_to_neutral_on_api_error(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("POLYGON_API_KEY", "polygon-test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-test")
    get_settings.cache_clear()

    scorer = NewsSentimentScorer()
    article = make_article("n-2")

    with respx.mock(assert_all_called=True) as router:
        router.post(ANTHROPIC_API_URL).mock(return_value=Response(500, json={"error": "oops"}))
        scored = await scorer.score_articles([article])

    assert len(scored) == 1
    assert scored[0].sentiment == Newssentiment.NEUTRAL
    assert scored[0].sentiment_score == pytest.approx(0.0)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_score_article_parses_wrapped_json_response(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("POLYGON_API_KEY", "polygon-test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-test")
    get_settings.cache_clear()

    scorer = NewsSentimentScorer()
    article = make_article("n-3")

    with respx.mock(assert_all_called=True) as router:
        router.post(ANTHROPIC_API_URL).mock(
            return_value=Response(
                200,
                json={
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Here is the analysis:\n"
                                '{"sentiment":"bearish","score":-0.4,'
                                '"confidence":0.7,"rationale":"Guidance lowered."}'
                            ),
                        }
                    ]
                },
            )
        )
        result = await scorer.score_article(article)

    assert result.sentiment == Newssentiment.BEARISH
    assert result.score == pytest.approx(-0.4)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_score_article_retries_on_429(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("POLYGON_API_KEY", "polygon-test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-test")
    get_settings.cache_clear()

    scorer = NewsSentimentScorer(max_retries=1)
    article = make_article("n-4")

    with respx.mock(assert_all_called=True) as router:
        route = router.post(ANTHROPIC_API_URL)
        route.side_effect = [
            Response(429, json={"error": "rate limited"}),
            Response(
                200,
                json={
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                '{"sentiment":"neutral","score":0.0,'
                                '"confidence":0.6,"rationale":"Mixed signals."}'
                            ),
                        }
                    ]
                },
            ),
        ]
        result = await scorer.score_article(article)

    assert result.sentiment == Newssentiment.NEUTRAL
    assert route.call_count == 2


@pytest.mark.unit
@pytest.mark.asyncio
async def test_score_article_retry_failure_exposes_status_context(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("POLYGON_API_KEY", "polygon-test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-test")
    get_settings.cache_clear()

    scorer = NewsSentimentScorer(max_retries=1)
    article = make_article("n-5")

    with respx.mock(assert_all_called=True) as router:
        route = router.post(ANTHROPIC_API_URL)
        route.side_effect = [
            Response(429, json={"error": "rate limited"}),
            Response(503, json={"error": "unavailable"}),
        ]
        with pytest.raises(Exception, match="status=503"):
            await scorer.score_article(article)
