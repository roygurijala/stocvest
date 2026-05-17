"""Reliable symbol-scoped news fetch for the ticker news panel (REST-first)."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any

from stocvest.api.services.news_relevance import _article_tickers_upper  # shared with MI relevance + panel
from stocvest.data.benzinga_client import BenzingaArticle, BenzingaClient
from stocvest.data.polygon_client import PolygonClient
from stocvest.data.ticker_name_resolver import article_matches_ticker


def benzinga_articles_to_news_rows(items: list[BenzingaArticle]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for a in items:
        title = str(a.title or "").strip()
        if not title:
            continue
        pub = a.published_at
        if pub.tzinfo is None:
            pub = pub.replace(tzinfo=timezone.utc)
        out.append(
            {
                "id": str(a.article_id or ""),
                "title": title,
                "description": str(a.body or "").strip() or None,
                "published_utc": pub.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                "tickers": list(a.tickers or []),
                "source": str(a.source or "benzinga"),
                "article_url": a.url,
                "publisher": {"name": "Benzinga"},
                "insights": [],
            }
        )
    return out


def merge_benzinga_first_news_rows(
    polygon_rows: list[dict[str, Any]],
    bz_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    titles = {
        str(r.get("title") or "").strip().lower()
        for r in bz_rows
        if isinstance(r, dict) and str(r.get("title") or "").strip()
    }
    out = list(bz_rows)
    for r in polygon_rows:
        if not isinstance(r, dict):
            continue
        t = str(r.get("title") or "").strip().lower()
        if not t or t in titles:
            continue
        out.append(r)
        titles.add(t)
    return out


def normalize_article_for_symbol(article: dict[str, Any], symbol: str) -> dict[str, Any]:
    """Ensure ticker metadata exists when the headline clearly names the symbol."""
    sym = symbol.strip().upper()
    tickers = _article_tickers_upper(article)
    if sym in tickers:
        return enrich_article_ticker_metadata(article, symbol)
    title = str(article.get("title") or "")
    raw = [str(t).strip().upper() for t in (article.get("tickers") or []) if str(t).strip()]
    if article_matches_ticker(title, raw, sym):
        merged = dict(article)
        merged["tickers"] = list(dict.fromkeys([*raw, sym]))
        return enrich_article_ticker_metadata(merged, symbol)
    return enrich_article_ticker_metadata(article, symbol)


def enrich_article_ticker_metadata(article: dict[str, Any], symbol: str) -> dict[str, Any]:
    """
    Merge Polygon insights + tickers into ``tickers`` so panel filters match the composite news layer.

    The composite ``NewsAnalyzer`` keeps rows with insight-only ticker tags; the panel previously
    dropped them when ``tickers`` was empty or matching ran before normalization.
    """
    sym = symbol.strip().upper()
    merged = dict(article)
    upper = _article_tickers_upper(merged)
    raw = [str(t).strip().upper() for t in (merged.get("tickers") or []) if str(t).strip()]
    tickers = list(dict.fromkeys([*raw, *upper]))
    title = str(merged.get("title") or "")
    if sym not in tickers and article_matches_ticker(title, tickers, sym):
        tickers.append(sym)
    if tickers:
        merged["tickers"] = tickers
    return merged


def article_matches_symbol_panel(article: dict[str, Any], symbol: str) -> bool:
    sym = symbol.strip().upper()
    if sym in _article_tickers_upper(article):
        return True
    title = str(article.get("title") or "")
    raw = [str(t).strip().upper() for t in (article.get("tickers") or []) if str(t).strip()]
    return article_matches_ticker(title, raw, sym)


async def fetch_symbol_panel_raw_articles(
    *,
    symbol: str,
    since: datetime,
    fetch_limit: int,
    client_factory: Callable[..., PolygonClient],
    polygon_api_key: str,
) -> list[dict[str, Any]]:
    """
    Fetch raw rows for the news panel: Benzinga REST (20d window) + Polygon REST.

    Avoids the Benzinga websocket replay path (short deadline, often sparse for one ticker).
    """
    sym = symbol.strip().upper()
    async with client_factory(api_key=polygon_api_key) as client:
        if hasattr(client, "get_market_news_polygon_fallback"):
            polygon_rows = await client.get_market_news_polygon_fallback(
                tickers=[sym],
                limit=fetch_limit,
                published_utc_gte=since,
            )
        else:
            polygon_rows = await client.get_market_news(
                tickers=[sym],
                limit=fetch_limit,
                published_utc_gte=since,
            )

    days = max(1, min(20, (datetime.now(timezone.utc) - since.astimezone(timezone.utc)).days + 1))
    bz_items = await BenzingaClient().get_news_for_symbol_panel(sym, days=days, limit=min(50, fetch_limit))
    bz_rows = benzinga_articles_to_news_rows(bz_items)
    return merge_benzinga_first_news_rows(polygon_rows, bz_rows)
