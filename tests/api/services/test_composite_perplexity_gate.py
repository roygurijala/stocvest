"""composite_perplexity_gate — swing Perplexity invocation context."""

from __future__ import annotations

from stocvest.api.services.composite_perplexity_gate import (
    resolve_swing_perplexity_invocation,
    user_has_symbol_on_default_watchlist,
)
from stocvest.data.watchlist_store import WatchlistItem, get_in_memory_watchlist_store
from stocvest.signals.news_analyzer import NewsLayerResult


def _empty_news(article_count: int = 0) -> NewsLayerResult:
    return NewsLayerResult(
        status="available",
        score=50,
        verdict="neutral",
        article_count=article_count,
        weighted_sentiment=0.0,
        data_state="stale",
    )


def test_off_mode_blocks_all_perplexity() -> None:
    inv = resolve_swing_perplexity_invocation(
        "off",
        user_id="u1",
        symbol="AAPL",
        news=_empty_news(),
    )
    assert inv.apply_layers is False
    assert inv.allow_analyst_perplexity is False


def test_deep_dive_allows_layers_and_analyst() -> None:
    inv = resolve_swing_perplexity_invocation(
        "deep_dive",
        user_id="u1",
        symbol="AAPL",
        news=_empty_news(),
    )
    assert inv.apply_layers is True
    assert inv.news_only is False
    assert inv.watchlist_thin is False
    assert inv.on_demand is True
    assert inv.allow_analyst_perplexity is True


def test_watchlist_thin_requires_default_watchlist_and_empty_news() -> None:
    store = get_in_memory_watchlist_store()
    store.create_watchlist(
        user_id="wl-user",
        name="Default",
        symbols=["NVDA"],
        is_default=True,
    )
    assert user_has_symbol_on_default_watchlist("wl-user", "NVDA") is True
    assert user_has_symbol_on_default_watchlist("wl-user", "AAPL") is False

    allowed = resolve_swing_perplexity_invocation(
        "watchlist_thin",
        user_id="wl-user",
        symbol="NVDA",
        news=_empty_news(0),
    )
    assert allowed.apply_layers is True
    assert allowed.news_only is True
    assert allowed.watchlist_thin is True
    assert allowed.allow_analyst_perplexity is False

    with_articles = resolve_swing_perplexity_invocation(
        "watchlist_thin",
        user_id="wl-user",
        symbol="NVDA",
        news=_empty_news(2),
    )
    assert with_articles.apply_layers is False

    off_watchlist = resolve_swing_perplexity_invocation(
        "watchlist_thin",
        user_id="wl-user",
        symbol="AAPL",
        news=_empty_news(0),
    )
    assert off_watchlist.apply_layers is False


def test_watchlist_match_normalizes_class_share_symbols() -> None:
    store = get_in_memory_watchlist_store()
    store.create_watchlist(
        user_id="wl-user",
        name="Default",
        symbols=["BRK.B"],
        is_default=True,
    )
    assert user_has_symbol_on_default_watchlist("wl-user", "BRK-B") is True
    assert user_has_symbol_on_default_watchlist("wl-user", "brk.b") is True
