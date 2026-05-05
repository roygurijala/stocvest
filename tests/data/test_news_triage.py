"""Unit tests for news triage (no Redis; active tickers patched)."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from stocvest.data.models import NewsArticle
from stocvest.data.news_triage import NewsTriage


def _article(
    *,
    title: str = "Company beats estimates on revenue",
    source: str = "benzinga",
    tickers: list[str] | None = None,
    categories: list[str] | None = None,
    company_name: str | None = "ACME Corp",
    article_id: str = "a1",
) -> NewsArticle:
    return NewsArticle(
        article_id=article_id,
        published_at=datetime(2026, 5, 5, 15, 30, tzinfo=timezone.utc),
        title=title,
        description=None,
        url="https://example.com/n",
        source=source,
        tickers=tickers or [],
        keywords=[],
        company_name=company_name,
        categories=categories or [],
    )


class TestSecEdgarAlwaysPasses:
    def test_sec_edgar(self) -> None:
        t = NewsTriage()
        art = _article(title="8-K filed", source="sec_edgar")
        ok, reason = t.should_score(art)
        assert ok is True
        assert reason == "sec_edgar_always"


class TestHighImpactCategory:
    def test_earnings_category(self) -> None:
        t = NewsTriage()
        art = _article(title="Routine headline without triggers", categories=["earnings"])
        ok, reason = t.should_score(art)
        assert ok is True
        assert reason == "high_impact_category"


class TestTriggerKeywords:
    def test_bullish(self) -> None:
        t = NewsTriage()
        art = _article(title="Firm upgraded to buy", categories=[])
        ok, reason = t.should_score(art)
        assert ok is True
        assert reason == "trigger_keyword"

    def test_bearish(self) -> None:
        t = NewsTriage()
        art = _article(title="Company misses expectations", categories=[])
        ok, reason = t.should_score(art)
        assert ok is True
        assert reason == "trigger_keyword"


class TestActiveTicker:
    def test_watched_ticker_passes(self) -> None:
        t = NewsTriage()
        art = _article(title="Brief note", tickers=["ZZZ"], categories=[])
        with patch.object(NewsTriage, "get_active_tickers", return_value={"ZZZ"}):
            ok, reason = t.should_score(art)
        assert ok is True
        assert reason == "active_signal_ticker"


class TestSpamAndPolygon:
    def test_title_too_short(self) -> None:
        t = NewsTriage()
        art = _article(title="Hi", source="benzinga")
        ok, reason = t.should_score(art)
        assert ok is False
        assert reason == "title_too_short"

    def test_polygon_filtered(self) -> None:
        t = NewsTriage()
        art = _article(
            title="Market update for investors",
            source="polygon",
            tickers=[],
            categories=[],
        )
        with patch.object(NewsTriage, "get_active_tickers", return_value=set()):
            ok, reason = t.should_score(art)
        assert ok is False
        assert reason == "polygon_backup_filtered"


class TestDuplicateHour:
    def test_second_article_same_company_hour_dropped(self) -> None:
        t = NewsTriage()
        base = _article(
            title="Minor market chatter",
            source="benzinga",
            article_id="first",
        )
        dup = _article(
            title="Different minor headline",
            source="benzinga",
            article_id="second",
        )
        with patch.object(NewsTriage, "get_active_tickers", return_value=set()):
            ok1, _ = t.should_score(base)
            ok2, reason2 = t.should_score(dup)
        assert ok1 is True
        assert ok2 is False
        assert reason2 == "duplicate_company_hour"
