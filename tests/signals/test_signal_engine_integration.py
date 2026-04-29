from __future__ import annotations

from datetime import datetime, timezone

import pytest
import respx
from httpx import Response

from stocvest.data.models import NewsArticle
from stocvest.signals.ai_synthesis import AISynthesis, SynthesisInput, TradeAction
from stocvest.signals.composite_score import CompositeScoreEngine, LayerSignal
from stocvest.signals.geopolitical_scanner import GeopoliticalScanner
from stocvest.signals.macro_events import MacroEventDetector
from stocvest.signals.news_sentiment import ANTHROPIC_API_URL, NewsSentimentScorer
from stocvest.utils.config import get_settings


def make_article(article_id: str, title: str, description: str) -> NewsArticle:
    return NewsArticle(
        article_id=article_id,
        published_at=datetime(2026, 4, 28, 14, 0, tzinfo=timezone.utc),
        title=title,
        description=description,
        url=f"https://example.com/{article_id}",
        source="ExampleWire",
        tickers=["SPY"],
        keywords=[],
    )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_end_to_end_signal_pipeline_bullish(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("POLYGON_API_KEY", "polygon-test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-test")
    get_settings.cache_clear()

    articles = [
        make_article("i-1", "CPI cools as inflation slows", "Below expectations print."),
        make_article("i-2", "Risk appetite improves", "Tech leads broad rally."),
    ]

    sentiment = NewsSentimentScorer()
    macro = MacroEventDetector()
    geo = GeopoliticalScanner()
    composite_engine = CompositeScoreEngine()
    synthesis = AISynthesis()

    with respx.mock(assert_all_called=True) as router:
        route = router.post(ANTHROPIC_API_URL)
        route.side_effect = [
            Response(
                200,
                json={
                    "content": [
                        {
                            "type": "text",
                            "text": '{"sentiment":"bullish","score":0.8,"confidence":0.9,"rationale":"Cooling CPI."}',
                        }
                    ]
                },
            ),
            Response(
                200,
                json={
                    "content": [
                        {
                            "type": "text",
                            "text": '{"sentiment":"bullish","score":0.6,"confidence":0.8,"rationale":"Risk appetite."}',
                        }
                    ]
                },
            ),
            Response(
                200,
                json={
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                '{"risk_level":"low","risk_score":0.2,"market_bias":1,"confidence":0.8,'
                                '"summary":"No escalation.","drivers":[],"impacted_regions":[]}'
                            ),
                        }
                    ]
                },
            ),
        ]

        scored_news = await sentiment.score_articles(articles)
        macro_events = macro.detect_from_articles(articles)
        geo_assessment = await geo.scan(articles)

    news_score = sum((a.sentiment_score or 0.0) for a in scored_news) / len(scored_news)
    macro_score = macro.aggregate_market_bias(macro_events)
    geo_score = geo_assessment.market_bias * geo_assessment.risk_score
    composite = composite_engine.compute(
        [
            LayerSignal(layer="technical", score=0.55, confidence=0.85),
            LayerSignal(layer="news", score=news_score, confidence=0.8),
            LayerSignal(layer="macro", score=macro_score, confidence=0.75),
            LayerSignal(layer="geopolitical", score=geo_score, confidence=geo_assessment.confidence),
            LayerSignal(layer="internals", score=0.3, confidence=0.7),
        ],
        regime="bull",
    )

    prompt = synthesis.build_prompt(
        payload=SynthesisInput(
            symbol="SPY",
            regime="bull",
            composite=composite,
            macro_events=macro_events,
            geopolitical=geo_assessment,
            news_items_scored=len(scored_news),
        )
    )
    verdict = synthesis.parse_response(
        symbol="SPY",
        response_text=(
            '{"action":"buy","conviction":0.76,"confidence":0.81,'
            '"position_size_pct":0.3,"stop_loss_pct":0.03,"take_profit_pct":0.09,'
            '"rationale":"Bullish stack with contained geopolitical risk.",'
            '"risks":["policy surprise"],"timeframe":"swing"}'
        ),
    )

    assert "symbol=SPY" in prompt
    assert composite.score > 0
    assert verdict.action == TradeAction.BUY


@pytest.mark.unit
@pytest.mark.asyncio
async def test_end_to_end_pipeline_handles_geopolitical_fallback(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("POLYGON_API_KEY", "polygon-test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "anthropic-test")
    get_settings.cache_clear()

    articles = [
        make_article("i-3", "War tensions escalate", "Missile attacks and sanctions announced."),
    ]

    sentiment = NewsSentimentScorer(max_retries=0)
    macro = MacroEventDetector()
    geo = GeopoliticalScanner(max_retries=0)
    composite_engine = CompositeScoreEngine()
    synthesis = AISynthesis()

    with respx.mock(assert_all_called=True) as router:
        route = router.post(ANTHROPIC_API_URL)
        route.side_effect = [
            Response(
                200,
                json={
                    "content": [
                        {
                            "type": "text",
                            "text": '{"sentiment":"bearish","score":-0.7,"confidence":0.8,"rationale":"Escalation risk."}',
                        }
                    ]
                },
            ),
            Response(500, json={"error": "geo unavailable"}),
        ]
        scored_news = await sentiment.score_articles(articles)
        geo_assessment = await geo.scan(articles)
        macro_events = macro.detect_from_articles(articles)

    composite = composite_engine.compute(
        [
            LayerSignal(layer="technical", score=-0.3, confidence=0.7),
            LayerSignal(layer="news", score=scored_news[0].sentiment_score or 0.0, confidence=0.8),
            LayerSignal(layer="macro", score=macro.aggregate_market_bias(macro_events), confidence=0.6),
            LayerSignal(
                layer="geopolitical",
                score=geo_assessment.market_bias * geo_assessment.risk_score,
                confidence=geo_assessment.confidence,
            ),
            LayerSignal(layer="internals", score=-0.25, confidence=0.7),
        ],
        regime="bear",
    )

    verdict = synthesis.parse_response(
        symbol="SPY",
        response_text=(
            '{"action":"hold","conviction":0.58,"confidence":0.66,'
            '"position_size_pct":0.05,"stop_loss_pct":0.02,"take_profit_pct":0.03,'
            '"rationale":"High geopolitical uncertainty; de-risk.",'
            '"risks":["escalation risk","headline volatility"],"timeframe":"swing"}'
        ),
    )

    assert geo_assessment.market_bias == -1
    assert geo_assessment.risk_score >= 0.4
    assert composite.score < 0
    assert verdict.action == TradeAction.HOLD
