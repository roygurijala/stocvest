"""API-oriented tests for market intelligence relevance, categories, and news handler caps."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from stocvest.api.handlers.market_data import news_handler
from stocvest.api.services.news_relevance import calculate_article_relevance, categorize_article, deduplicate_articles
from tests.api.handlers.test_market_data import _FakePolygonClient


def _art(
    *,
    title: str,
    publisher: str = "Reuters",
    tickers: list[str] | None = None,
    published_utc: str | None = None,
    description: str = "",
) -> dict:
    when = published_utc
    if when is None:
        when = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "title": title,
        "description": description,
        "publisher": {"name": publisher},
        "tickers": tickers or ["AAPL"],
        "published_utc": when,
        "insights": [],
    }


def test_earnings_article_scores_highest() -> None:
    recent = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    a = _art(
        title="MegaCorp beats earnings expectations on strong revenue",
        publisher="Reuters",
        published_utc=recent,
    )
    assert calculate_article_relevance(a, []) >= 60


def test_pr_wire_penalized() -> None:
    recent = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    t = "MegaCorp reports quarterly EPS beat"
    baseline = _art(title=t, publisher="RandomCo News Wire", published_utc=recent)
    wire = _art(title=t, publisher="GlobeNewswire", published_utc=recent)
    assert calculate_article_relevance(baseline, []) - calculate_article_relevance(wire, []) == 25


def test_reuters_scores_higher_than_benzinga() -> None:
    recent = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    t = "Same headline about semiconductor demand trends"
    r = _art(title=t, publisher="Reuters", published_utc=recent)
    b = _art(title=t, publisher="Benzinga", published_utc=recent)
    assert calculate_article_relevance(r, []) > calculate_article_relevance(b, [])


def test_recent_article_scores_higher() -> None:
    t = "Market update"
    old = _art(
        title=t,
        publisher="Reuters",
        published_utc=(datetime.now(timezone.utc) - timedelta(hours=3)).isoformat().replace("+00:00", "Z"),
    )
    new = _art(
        title=t,
        publisher="Reuters",
        published_utc=(datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat().replace("+00:00", "Z"),
    )
    assert calculate_article_relevance(new, []) > calculate_article_relevance(old, [])


def test_watchlist_match_adds_points() -> None:
    recent = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    base = _art(title="Some ticker story", publisher="Reuters", tickers=["NVDA"], published_utc=recent)
    assert calculate_article_relevance(base, ["NVDA"]) == calculate_article_relevance(base, []) + 10


def test_deduplication_keeps_best_source() -> None:
    t = "NVDA stock rallies on earnings beat and guidance"
    reuters = {"title": t, "tickers": ["NVDA"], "publisher": {"name": "Reuters"}, "_relevance_score": 80}
    other = {"title": t, "tickers": ["NVDA"], "publisher": {"name": "Benzinga"}, "_relevance_score": 70}
    out = deduplicate_articles([reuters, other])
    assert len(out) == 1
    assert out[0]["publisher"]["name"] == "Reuters"


def test_category_earnings_detected() -> None:
    assert categorize_article({"title": "AAPL beats Q2 earnings", "description": "", "tickers": []}) == "earnings"


def test_category_analyst_detected() -> None:
    assert categorize_article({"title": "Goldman raises NVDA price target", "description": "", "tickers": []}) == "analyst"


class _FiftyNewsClient(_FakePolygonClient):
    async def get_market_news(
        self,
        *,
        tickers: list[str] | None = None,
        limit: int = 50,
        order: str = "desc",
        published_utc_gte: datetime | None = None,
    ) -> list[dict]:
        _ = tickers
        _ = limit
        _ = order
        _ = published_utc_gte
        ts = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        out: list[dict] = []
        for i in range(50):
            pub = f"Publisher {i % 25}"
            out.append(
                {
                    "id": str(i),
                    "published_utc": ts,
                    "title": f"Company {i} equity moves on volume metrics session update",
                    "description": "Trading notes",
                    "article_url": f"https://e/{i}",
                    "publisher": {"name": pub},
                    "tickers": [f"Z{i}"],
                    "insights": [{"sentiment": "neutral"}],
                }
            )
        return out


def test_top_20_returned_not_all_50() -> None:
    event = {"queryStringParameters": {"limit": "100"}}
    response = news_handler(event, {}, client_factory=_FiftyNewsClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert len(body["headlines"]) <= 20
    assert len(body["headlines"]) >= 1
