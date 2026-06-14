"""Benzinga multi-feed health, news-layer degradation, and Perplexity gating."""

from __future__ import annotations

from stocvest.data.benzinga_client import BenzingaFeedHealth, BenzingaMultiResult
from stocvest.data.ticker_reference import TickerReference
from stocvest.signals.news_analyzer import NewsLayerResult


def feed_health_from_multi(data: BenzingaMultiResult | None) -> BenzingaFeedHealth:
    if data is None:
        return BenzingaFeedHealth(bundle="error")
    return data.feed_health


def benzinga_news_feed_degraded(data: BenzingaMultiResult | None) -> bool:
    """True when structured news inputs failed — not legitimate silence."""
    health = feed_health_from_multi(data)
    if health.bundle in ("timeout", "error"):
        return True
    if health.news == "error":
        return True
    return False


def benzinga_thin_coverage(data: BenzingaMultiResult | None) -> bool:
    """Configured feeds responded but returned no material bundle (ADR / micro-cap gap)."""
    if data is None:
        return False
    health = feed_health_from_multi(data)
    if health.news not in ("empty", "ok"):
        return False
    if data.news:
        return False
    if data.wim is not None:
        return False
    if data.ratings or data.guidance or data.earnings:
        return False
    return True


def qualifies_for_supplementary_news_context(
    *,
    ticker_ref: TickerReference | None,
    benzinga_data: BenzingaMultiResult | None,
) -> bool:
    if ticker_ref and ticker_ref.is_adr():
        country = str(ticker_ref.country_code or "").strip().upper()
        if country and country != "US":
            return True
    return benzinga_thin_coverage(benzinga_data)


def apply_news_degraded_if_feed_failed(
    news: NewsLayerResult,
    benzinga_data: BenzingaMultiResult | None,
) -> NewsLayerResult:
    if news.article_count > 0:
        return news
    if not benzinga_news_feed_degraded(benzinga_data):
        return news
    news.status = "degraded"
    news.data_state = "degraded"
    news.score = None
    news.verdict = "neutral"
    news.weighted_sentiment = None
    news.reasoning = (
        "News layer unavailable — structured Benzinga/Polygon fetch failed. "
        "Excluded from composite scoring."
    )
    news.chips = ["News: unavailable (feed error)"]
    return news


def layer_available_for_composite(status: str) -> bool:
    return str(status or "").strip().lower() in ("available", "as_of_close")


def composite_layers_meta(layer_results: list[object], layer_ids: list[str]) -> dict[str, object]:
    excluded = [
        lid
        for lid, res in zip(layer_ids, layer_results)
        if str(getattr(res, "status", "") or "").strip().lower() == "degraded"
    ]
    active = sum(
        1 for res in layer_results if layer_available_for_composite(getattr(res, "status", ""))
    )
    note = None
    if "news" in excluded:
        note = "News layer unavailable — composite based on remaining layers only."
    return {
        "composite_layers_total": len(layer_ids),
        "composite_layers_active": active,
        "layers_excluded": excluded,
        "layers_excluded_note": note,
    }
