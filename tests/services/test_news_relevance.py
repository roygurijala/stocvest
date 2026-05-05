from __future__ import annotations

from datetime import datetime, timedelta, timezone

from stocvest.api.services.news_relevance import (
    calculate_article_relevance,
    deduplicate_articles,
    publisher_credibility_rank,
    source_credibility_meta,
)


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


def test_calculate_article_relevance_earnings_beat_scores_high() -> None:
    a = _art(title="Apple Q4 earnings beat EPS and revenue estimates", publisher="Reuters")
    assert calculate_article_relevance(a, []) >= 40


def test_pr_wire_penalty_lowers_score_vs_wire_of_same_headline() -> None:
    recent = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    wire = _art(
        title="MegaCorp reports quarterly EPS beat",
        publisher="GlobeNewswire",
        published_utc=recent,
    )
    news = _art(
        title="MegaCorp reports quarterly EPS beat",
        publisher="Reuters",
        published_utc=recent,
    )
    assert calculate_article_relevance(wire, []) < calculate_article_relevance(news, [])


def test_watchlist_overlap_adds_points() -> None:
    recent = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    base = _art(title="Some ticker news", publisher="Reuters", tickers=["XYZ"], published_utc=recent)
    without = calculate_article_relevance(base, [])
    with_wl = calculate_article_relevance(base, ["XYZ"])
    assert with_wl == without + 10


def test_deduplicate_keeps_higher_credibility_at_equal_score() -> None:
    t = "NVDA surges after earnings beat revenue expectations"
    a = {"title": t, "tickers": ["NVDA"], "publisher": {"name": "GlobeNewswire"}, "_relevance_score": 55}
    b = {"title": t, "tickers": ["NVDA"], "publisher": {"name": "Reuters"}, "_relevance_score": 55}
    out = deduplicate_articles([a, b])
    assert len(out) == 1
    assert out[0]["publisher"]["name"] == "Reuters"


def test_publisher_credibility_rank_orders_major_outlets() -> None:
    assert publisher_credibility_rank("Reuters") > publisher_credibility_rank("Random Blog")


def test_source_credibility_meta_pr_wire() -> None:
    meta = source_credibility_meta("PR Newswire")
    assert meta["band"] == "pr_wire"


def test_dedupe_distinct_stories_remain() -> None:
    a = {"title": "Fed signals pause on rate hikes", "tickers": ["SPY"], "publisher": {"name": "Reuters"}, "_relevance_score": 80}
    b = {"title": "Oil jumps on supply disruption", "tickers": ["XOM"], "publisher": {"name": "Bloomberg"}, "_relevance_score": 75}
    out = deduplicate_articles([a, b])
    assert len(out) == 2


def test_old_article_gets_lower_recency_than_fresh() -> None:
    old = _art(
        title="Market update",
        publisher="Reuters",
        published_utc=(datetime.now(timezone.utc) - timedelta(days=2)).isoformat().replace("+00:00", "Z"),
    )
    new = _art(
        title="Market update",
        publisher="Reuters",
        published_utc=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    )
    assert calculate_article_relevance(new, []) > calculate_article_relevance(old, [])
