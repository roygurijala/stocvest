from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from stocvest.api.services.gap_intelligence_news import collect_news_for_gap_intelligence
from stocvest.data.models import NewsArticle, Snapshot
from stocvest.signals.day_trading_scanner import PremarketGapCandidate
from stocvest.signals.gap_intelligence import (
    _catalyst_lookback_hours_at,
    build_gap_intelligence_items,
)
from stocvest.signals.news_catalyst_detector import NewsCatalystDetector


def _snap(symbol: str, prev_close: float, price: float, vol: float, adv: float, name: str = "") -> Snapshot:
    return Snapshot(
        symbol=symbol,
        prev_close=prev_close,
        last_trade_price=price,
        day_volume=vol,
        prev_day_volume=adv,
        company_name=name or None,
    )


def _art(
    aid: str,
    title: str,
    *,
    tickers: list[str],
    hours_ago: int = 1,
) -> NewsArticle:
    return NewsArticle(
        article_id=aid,
        published_at=datetime.now(timezone.utc) - timedelta(hours=hours_ago),
        title=title,
        description="",
        url="https://example.com",
        source="Reuters",
        tickers=tickers,
        keywords=[],
    )


def test_lookback_48h_saturday_afternoon_et() -> None:
    ny = datetime(2026, 5, 2, 14, 0, tzinfo=ZoneInfo("America/New_York"))
    assert _catalyst_lookback_hours_at(ny) == 48


def test_lookback_24h_tuesday_mid_session_et() -> None:
    ny = datetime(2026, 5, 5, 10, 30, tzinfo=ZoneInfo("America/New_York"))
    assert _catalyst_lookback_hours_at(ny) == 24


def test_lookback_48h_weekday_premarket_et() -> None:
    ny = datetime(2026, 5, 4, 9, 0, tzinfo=ZoneInfo("America/New_York"))
    assert _catalyst_lookback_hours_at(ny) == 48


def test_lookback_48h_weekday_after_close_et() -> None:
    ny = datetime(2026, 5, 4, 20, 0, tzinfo=ZoneInfo("America/New_York"))
    assert _catalyst_lookback_hours_at(ny) == 48


@pytest.mark.asyncio
async def test_deduplication_removes_duplicate_articles() -> None:
    ts = datetime(2026, 5, 2, 12, 0, tzinfo=timezone.utc)
    shared = NewsArticle(
        article_id="same-id",
        published_at=ts,
        title="Shared headline",
        description="",
        url="https://example.com/a",
        source="Reuters",
        tickers=["AAA"],
        keywords=[],
    )

    class FakeClient:
        async def get_news(self, symbol=None, limit: int = 50):
            _ = limit
            if symbol is None:
                return [shared]
            return [shared]

    out = await collect_news_for_gap_intelligence(FakeClient(), ["AAA"], global_limit=50, per_symbol_limit=5)
    assert len(out) == 1
    assert out[0].article_id == "same-id"


@pytest.mark.asyncio
async def test_per_symbol_news_fetched_for_gap_candidates() -> None:
    ts = datetime(2026, 5, 2, 12, 0, tzinfo=timezone.utc)

    class FakeClient:
        calls: list[tuple[str | None, int]] = []

        async def get_news(self, symbol=None, limit: int = 50):
            self.calls.append((symbol, limit))
            if symbol is None:
                return [
                    NewsArticle(
                        article_id="g1",
                        published_at=ts,
                        title="Market wrap",
                        description="",
                        url="https://example.com/g1",
                        source="Reuters",
                        tickers=["SPY"],
                        keywords=[],
                    )
                ]
            return [
                NewsArticle(
                    article_id=f"x-{symbol}",
                    published_at=ts,
                    title=f"{symbol} upgraded by analysts",
                    description="",
                    url=f"https://example.com/{symbol}",
                    source="Reuters",
                    tickers=[symbol],
                    keywords=[],
                )
            ]

    fc = FakeClient()
    await collect_news_for_gap_intelligence(fc, ["ZZZ", "YYY"], global_limit=40, per_symbol_limit=3, max_symbols=10)
    syms = [c[0] for c in fc.calls]
    assert None in syms
    assert "ZZZ" in syms and "YYY" in syms


def test_company_name_fallback_matches_article() -> None:
    gaps = [
        PremarketGapCandidate(
            symbol="GME",
            prev_close=100.0,
            premarket_price=110.0,
            gap_percent=10.0,
            day_volume=900_000.0,
            direction="up",
            rank_score=10.0,
        )
    ]
    snaps = {"GME": _snap("GME", prev_close=100, price=110, vol=900_000, adv=400_000, name="GameStop Corporation")}
    arts = [
        NewsArticle(
            article_id="gme-n",
            published_at=datetime.now(timezone.utc),
            title="GameStop shares surge after analyst upgrade",
            description="",
            url="https://example.com",
            source="Reuters",
            tickers=[],
            keywords=[],
        )
    ]
    items = build_gap_intelligence_items(gaps, snaps, arts, news_lookback_hours=48)
    assert len(items) == 1
    assert items[0]["has_catalyst"] is True
    assert items[0]["catalyst"] is not None


def test_broad_noise_phrase_this_week_not_blocking_fda_headline() -> None:
    det = NewsCatalystDetector(min_score=0.2)
    title = "FDA approved drug this week in pivotal trial"
    assert not det._headline_is_noise(title)


def test_listicle_pattern_detected() -> None:
    det = NewsCatalystDetector(min_score=0.2)
    assert det._headline_is_noise("5 stocks to buy right now before earnings")
    assert not det._headline_is_noise("NVDA earnings beat estimates on strong data center demand")


def test_company_fallback_narrative_penalty_vs_ticker_match() -> None:
    det = NewsCatalystDetector(min_score=0.2)
    ts = datetime(2026, 5, 2, 12, 0, tzinfo=timezone.utc)
    art = NewsArticle(
        article_id="p1",
        published_at=ts,
        title="GameStop posts record revenue growth",
        description="",
        url="https://example.com",
        source="Reuters",
        tickers=["GME"],
        keywords=["revenue"],
    )
    via_ticker = det.candidate_for_symbol(art, "GME", company_name="GameStop Corporation")
    art2 = NewsArticle(
        article_id="p2",
        published_at=ts,
        title="GameStop posts record revenue growth",
        description="",
        url="https://example.com",
        source="Reuters",
        tickers=[],
        keywords=["revenue"],
    )
    via_company = det.candidate_for_symbol(art2, "GME", company_name="GameStop Corporation")
    assert via_ticker is not None and via_company is not None
    assert via_ticker.narrative_score >= via_company.narrative_score
