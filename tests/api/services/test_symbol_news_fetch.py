from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from stocvest.api.services.symbol_news_fetch import (
    article_matches_symbol_panel,
    enrich_article_ticker_metadata,
    fetch_symbol_panel_raw_articles,
    merge_benzinga_first_news_rows,
    normalize_article_for_symbol,
)
from stocvest.api.services.news_quality_filter import passes_market_intelligence_gate
from stocvest.data.benzinga_client import BenzingaArticle


def test_merge_benzinga_first_dedupes_polygon_by_title() -> None:
    bz = [{"title": "Amazon rises", "tickers": ["AMZN"]}]
    poly = [{"title": "Amazon rises", "tickers": ["AMZN"]}, {"title": "Unique poly", "tickers": ["AMZN"]}]
    merged = merge_benzinga_first_news_rows(poly, bz)
    titles = {str(r["title"]) for r in merged}
    assert titles == {"Amazon rises", "Unique poly"}


def test_article_matches_symbol_panel_title_variant() -> None:
    article = {
        "title": "Amazon.com shares gain on AWS update",
        "description": "d",
        "tickers": [],
    }
    assert article_matches_symbol_panel(article, "AMZN") is True
    normalized = normalize_article_for_symbol(article, "AMZN")
    assert "AMZN" in normalized["tickers"]


def test_article_matches_symbol_panel_requires_ticker_when_no_name_hit() -> None:
    article = {"title": "Retail sector ETF flows", "description": "d", "tickers": ["XRT"]}
    assert article_matches_symbol_panel(article, "AMZN") is False


def test_enrich_article_ticker_metadata_merges_insights() -> None:
    article = {
        "title": "Cloud demand lifts hyperscaler peers",
        "description": "d",
        "tickers": [],
        "insights": [{"ticker": "AMZN", "sentiment": "positive"}],
        "publisher": {"name": "Reuters"},
    }
    enriched = enrich_article_ticker_metadata(article, "AMZN")
    assert "AMZN" in enriched["tickers"]
    assert article_matches_symbol_panel(enriched, "AMZN") is True
    assert passes_market_intelligence_gate(enriched) is True


@pytest.mark.asyncio
async def test_fetch_symbol_panel_uses_polygon_rest_and_benzinga(monkeypatch: pytest.MonkeyPatch) -> None:
    since = datetime.now(timezone.utc) - timedelta(days=20)
    poly_called: list[str] = []

    class FakePoly:
        def __init__(self, api_key: str) -> None:
            _ = api_key

        async def __aenter__(self) -> FakePoly:
            return self

        async def __aexit__(self, *exc: object) -> None:
            return None

        async def get_market_news_polygon_fallback(
            self,
            *,
            tickers: list[str] | None = None,
            limit: int = 50,
            order: str = "desc",
            published_utc_gte: datetime | None = None,
        ) -> list[dict]:
            _ = limit
            _ = order
            _ = published_utc_gte
            poly_called.extend(tickers or [])
            return [
                {
                    "id": "p1",
                    "title": "Polygon AMZN",
                    "description": "d",
                    "published_utc": "2026-05-10T12:00:00Z",
                    "tickers": ["AMZN"],
                    "publisher": {"name": "Reuters"},
                }
            ]

    async def fake_bz_panel(self, symbol: str, *, days: int = 20, limit: int = 50) -> list[BenzingaArticle]:
        _ = days
        _ = limit
        assert symbol == "AMZN"
        return [
            BenzingaArticle(
                article_id="b1",
                title="Benzinga AMZN",
                body="body",
                published_at=datetime(2026, 5, 11, tzinfo=timezone.utc),
                tickers=["AMZN"],
                channels=[],
            )
        ]

    monkeypatch.setattr(
        "stocvest.api.services.symbol_news_fetch.BenzingaClient.get_news_for_symbol_panel",
        fake_bz_panel,
    )

    rows = await fetch_symbol_panel_raw_articles(
        symbol="AMZN",
        since=since,
        fetch_limit=100,
        client_factory=FakePoly,
        polygon_api_key="key",
    )
    assert poly_called == ["AMZN"]
    titles = {r["title"] for r in rows}
    assert titles == {"Benzinga AMZN", "Polygon AMZN"}
