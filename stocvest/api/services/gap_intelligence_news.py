"""Fetch and merge Polygon news for gap intelligence (global + per-symbol)."""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

from stocvest.data.models import NewsArticle

if TYPE_CHECKING:
    from stocvest.data import PolygonClient

_LOG = logging.getLogger(__name__)


async def collect_news_for_gap_intelligence(
    client: PolygonClient,
    gap_symbols: list[str],
    *,
    global_limit: int = 120,
    per_symbol_limit: int = 5,
    max_symbols: int = 10,
) -> list[NewsArticle]:
    """
    Pass 1: recent market-wide news. Pass 2: per-gap-symbol news (Polygon ``ticker`` filter).

    Deduplicates by ``article_id`` (fallback key: title + published_at).
    """
    uniq: list[str] = []
    seen_sym: set[str] = set()
    for raw in gap_symbols:
        u = raw.strip().upper()
        if u and u not in seen_sym:
            seen_sym.add(u)
            uniq.append(u)
        if len(uniq) >= max_symbols:
            break

    global_news = await client.get_news(limit=max(30, global_limit))

    async def one(sym: str) -> list[NewsArticle]:
        try:
            return await client.get_news(symbol=sym, limit=per_symbol_limit)
        except Exception as exc:  # noqa: BLE001 — one symbol must not fail the scan
            _LOG.debug("get_news symbol=%s failed: %s", sym, exc)
            return []

    chunks = await asyncio.gather(*[one(s) for s in uniq]) if uniq else []
    symbol_news: list[NewsArticle] = []
    for ch in chunks:
        symbol_news.extend(ch)

    seen_ids: set[str] = set()
    out: list[NewsArticle] = []
    for art in global_news + symbol_news:
        aid = (art.article_id or "").strip()
        key = aid if aid else f"{art.title}|{art.published_at.isoformat()}"
        if key in seen_ids:
            continue
        seen_ids.add(key)
        out.append(art)
    return out
