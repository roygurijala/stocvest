from datetime import date

from datetime import datetime, timezone

from stocvest.api.services.benzinga_feed_health import (
    apply_news_degraded_if_feed_failed,
    benzinga_news_feed_degraded,
    benzinga_thin_coverage,
    qualifies_for_supplementary_news_context,
)
from stocvest.api.services.symbol_perplexity_enrichment import needs_perplexity_news as gate_news
from stocvest.data.benzinga_client import BenzingaFeedHealth, BenzingaMultiResult, BenzingaWIMEntry
from stocvest.data.ticker_reference import TickerReference
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


def _ggal_ref() -> TickerReference:
    return TickerReference(
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


def test_benzinga_news_feed_degraded_on_timeout() -> None:
    bz = BenzingaMultiResult(feed_health=BenzingaFeedHealth(bundle="timeout"))
    assert benzinga_news_feed_degraded(bz) is True


def test_unconfigured_news_feed_is_not_degraded() -> None:
    bz = BenzingaMultiResult()
    assert benzinga_news_feed_degraded(bz) is False


def test_benzinga_thin_coverage_requires_empty_bundle() -> None:
    bz = BenzingaMultiResult(feed_health=BenzingaFeedHealth(news="empty"))
    assert benzinga_thin_coverage(bz) is True


def test_us_empty_news_does_not_qualify_without_adr_or_thin_bundle() -> None:
    bz = BenzingaMultiResult(
        wim=BenzingaWIMEntry(
            symbol="AAPL",
            reason="Earnings beat",
            direction="up",
            published_at=datetime.now(timezone.utc),
        ),
        feed_health=BenzingaFeedHealth(news="empty"),
    )
    assert qualifies_for_supplementary_news_context(ticker_ref=None, benzinga_data=bz) is False
    assert gate_news(_empty_news(), bz, ticker_ref=None) is False


def test_thin_bundle_qualifies_for_supplementary_without_adr() -> None:
    bz = BenzingaMultiResult(feed_health=BenzingaFeedHealth(news="empty"))
    assert qualifies_for_supplementary_news_context(ticker_ref=None, benzinga_data=bz) is True
    assert gate_news(_empty_news(), bz, ticker_ref=None) is True


def test_us_empty_news_skips_perplexity_when_not_thin() -> None:
    bz = BenzingaMultiResult(
        ratings=[],
        feed_health=BenzingaFeedHealth(news="empty", ratings="empty"),
    )
    # Simulate analyst sub-score present — should not need perplexity
    news = _empty_news()
    news.analyst_sub_score = 0.2
    news.data_state = "fresh"
    assert gate_news(news, bz, ticker_ref=None) is False


def test_ggal_adr_qualifies_for_supplementary_news() -> None:
    bz = BenzingaMultiResult(feed_health=BenzingaFeedHealth(news="empty"))
    assert qualifies_for_supplementary_news_context(ticker_ref=_ggal_ref(), benzinga_data=bz) is True
    assert gate_news(_empty_news(), bz, ticker_ref=_ggal_ref()) is True


def test_degraded_news_skips_perplexity() -> None:
    news = _empty_news()
    news.status = "degraded"
    news.data_state = "degraded"
    bz = BenzingaMultiResult(feed_health=BenzingaFeedHealth(news="error"))
    assert gate_news(news, bz, ticker_ref=_ggal_ref()) is False


def test_apply_news_degraded_marks_layer_unavailable() -> None:
    bz = BenzingaMultiResult(feed_health=BenzingaFeedHealth(news="error"))
    out = apply_news_degraded_if_feed_failed(_empty_news(), bz)
    assert out.status == "degraded"
    assert out.score is None
    assert "Excluded from composite" in out.reasoning
