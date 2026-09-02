"""Gate Perplexity Sonar on swing composite entry context (ADR-001 DBZ-5)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from stocvest.data.symbol_normalize import to_polygon_symbol
from stocvest.signals.news_analyzer import NewsLayerResult
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

SwingPerplexityMode = Literal["off", "deep_dive", "watchlist_thin"]


@dataclass(frozen=True)
class SwingPerplexityInvocation:
    """Resolved Perplexity allowances for one swing composite run."""

    apply_layers: bool
    news_only: bool
    watchlist_thin: bool
    on_demand: bool
    allow_analyst_perplexity: bool


def user_has_symbol_on_default_watchlist(user_id: str | None, symbol: str) -> bool:
    if not user_id or not str(user_id).strip():
        return False
    sym = to_polygon_symbol(str(symbol or "").strip().upper())
    if not sym:
        return False
    try:
        from stocvest.data.watchlist_store import get_watchlist_store

        store = get_watchlist_store()
        wl = store.get_default_watchlist(str(user_id).strip())
        if wl is None:
            return False
        wl_syms = {to_polygon_symbol(str(s).strip().upper()) for s in (wl.symbols or []) if str(s).strip()}
        return sym in wl_syms
    except Exception as exc:  # noqa: BLE001
        _LOG.debug("watchlist lookup failed user=%s sym=%s: %s", user_id, symbol, exc)
        return False


def resolve_swing_perplexity_invocation(
    mode: SwingPerplexityMode,
    *,
    user_id: str | None,
    symbol: str,
    news: NewsLayerResult,
) -> SwingPerplexityInvocation:
    """Map caller context to Perplexity layer + analyst-target allowances."""
    if mode == "off":
        return SwingPerplexityInvocation(
            apply_layers=False,
            news_only=False,
            watchlist_thin=False,
            on_demand=False,
            allow_analyst_perplexity=False,
        )
    if mode == "deep_dive":
        return SwingPerplexityInvocation(
            apply_layers=True,
            news_only=False,
            watchlist_thin=False,
            on_demand=True,
            allow_analyst_perplexity=True,
        )
    if mode == "watchlist_thin":
        on_watchlist = user_has_symbol_on_default_watchlist(user_id, symbol)
        empty_news = int(news.article_count or 0) == 0
        allow = on_watchlist and empty_news
        return SwingPerplexityInvocation(
            apply_layers=allow,
            news_only=True,
            watchlist_thin=True,
            on_demand=False,
            allow_analyst_perplexity=False,
        )
    return SwingPerplexityInvocation(
        apply_layers=False,
        news_only=False,
        watchlist_thin=False,
        on_demand=False,
        allow_analyst_perplexity=False,
    )
