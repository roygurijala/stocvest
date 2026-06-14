from datetime import date

import pytest

from stocvest.api.services.symbol_perplexity_enrichment import (
    apply_perplexity_news_enrichment,
    maybe_apply_perplexity_layers,
    needs_perplexity_news,
)
from stocvest.data.benzinga_client import BenzingaMultiResult
from stocvest.data.ticker_reference import TickerReference
from stocvest.signals.macro_analyzer import MacroLayerResult
from stocvest.signals.news_analyzer import NewsLayerResult


def _empty_news() -> NewsLayerResult:
    return NewsLayerResult(
        status="available",
        score=50,
        verdict="neutral",
        article_count=0,
        weighted_sentiment=0.0,
        data_state="stale",
        chips=["No qualifying headlines"],
    )


def _thin_macro() -> MacroLayerResult:
    return MacroLayerResult(status="available", score=50, verdict="neutral")


def test_needs_perplexity_news_false_for_us_without_adr() -> None:
    assert needs_perplexity_news(_empty_news(), BenzingaMultiResult(), ticker_ref=None) is False


def test_needs_perplexity_news_when_stale_and_empty_for_adr() -> None:
    ref = TickerReference(
        symbol="GGAL",
        active=True,
        market_cap=1e9,
        security_type="ADRC",
        locale="us",
        country_code="AR",
        primary_exchange="XNYS",
        list_date=date(2010, 1, 1),
        name="Grupo Financiero Galicia",
    )
    assert needs_perplexity_news(_empty_news(), BenzingaMultiResult(), ticker_ref=ref) is True


def test_needs_perplexity_news_false_when_articles_present() -> None:
    news = _empty_news()
    news.article_count = 3
    assert needs_perplexity_news(news, BenzingaMultiResult(), ticker_ref=None) is False


def test_apply_perplexity_news_enrichment_labels_supplementary() -> None:
    from stocvest.api.services.symbol_perplexity_enrichment import PerplexityNewsEnrichment

    news = _empty_news()
    enrich = PerplexityNewsEnrichment(
        symbol="GGAL",
        summary="Policy tailwind offsets earnings softness.",
        sentiment="neutral",
        headwinds=["Q1 profit decline"],
        catalysts=["Reform momentum"],
    )
    updated = apply_perplexity_news_enrichment(
        news,
        enrich,
        params_bullish_threshold=63,
        params_bearish_threshold=45,
        ticker_ref=TickerReference(
            symbol="GGAL",
            active=True,
            market_cap=1e9,
            security_type="ADRC",
            locale="us",
            country_code="AR",
            primary_exchange="XNYS",
            list_date=date(2010, 1, 1),
            name="Grupo Financiero Galicia",
        ),
    )
    assert updated.data_state == "supplementary_context"
    assert "supplementary AI context" in " ".join(updated.chips)


@pytest.mark.asyncio
async def test_maybe_apply_perplexity_layers_skips_when_news_present() -> None:
    from unittest.mock import AsyncMock, patch

    news = _empty_news()
    news.article_count = 2
    macro = _thin_macro()
    with patch(
        "stocvest.api.services.symbol_perplexity_enrichment.fetch_news_enrichment",
        new=AsyncMock(),
    ) as mock_news:
        out_news, out_macro, p_news, p_macro = await maybe_apply_perplexity_layers(
            symbol="AAPL",
            ticker_ref=None,
            news=news,
            macro=macro,
            benzinga_data=BenzingaMultiResult(),
            economic_event_count=0,
            news_bullish_threshold=63,
            news_bearish_threshold=45,
        )
    mock_news.assert_not_called()
    assert p_news is None
    assert out_news.article_count == 2
