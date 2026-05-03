from __future__ import annotations

from datetime import datetime, timedelta, timezone

from stocvest.data.models import NewsArticle, Snapshot
from stocvest.signals.day_trading_scanner import PremarketGapCandidate
from stocvest.signals.gap_intelligence import (
    NO_CATALYST_WARNING,
    SECONDARY_SHARED_CATALYST_HEADLINE,
    build_gap_intelligence_items,
    calculate_gap_quality_score,
)


def _snap(
    symbol: str,
    *,
    prev_close: float,
    price: float,
    vol: float,
    adv: float,
    name: str = "",
) -> Snapshot:
    return Snapshot(
        symbol=symbol,
        prev_close=prev_close,
        last_trade_price=price,
        day_volume=vol,
        prev_day_volume=adv,
        company_name=name or None,
    )


def _art(title: str, tickers: list[str], hours_ago: int = 1) -> NewsArticle:
    return NewsArticle(
        article_id=f"id-{title[:8]}",
        published_at=datetime.now(timezone.utc) - timedelta(hours=hours_ago),
        title=title,
        description="",
        url="https://example.com",
        source="Reuters",
        tickers=tickers,
        keywords=[],
    )


def test_gap_with_news_combined_correctly() -> None:
    gaps = [
        PremarketGapCandidate(
            symbol="NVDA",
            prev_close=100.0,
            premarket_price=110.0,
            gap_percent=10.0,
            day_volume=900_000.0,
            direction="up",
            rank_score=10.0,
        )
    ]
    snaps = {"NVDA": _snap("NVDA", prev_close=100, price=110, vol=900_000, adv=400_000, name="NVIDIA")}
    arts = [_art("NVDA stock upgraded by analysts with higher price target", ["NVDA"])]
    items = build_gap_intelligence_items(gaps, snaps, arts)
    assert len(items) == 1
    assert items[0]["has_catalyst"] is True
    assert items[0]["catalyst"] is not None
    assert items[0]["catalyst"]["category"] == "analyst"
    cat = items[0]["catalyst"]
    assert cat.get("article_url") == "https://example.com"
    assert cat.get("source") == "Reuters"
    assert "published_at" in cat


def test_gap_without_news_shows_warning() -> None:
    gaps = [
        PremarketGapCandidate(
            symbol="XYZ",
            prev_close=10.0,
            premarket_price=11.0,
            gap_percent=10.0,
            day_volume=900_000.0,
            direction="up",
            rank_score=10.0,
        )
    ]
    snaps = {"XYZ": _snap("XYZ", prev_close=10, price=11, vol=900_000, adv=400_000)}
    items = build_gap_intelligence_items(gaps, snaps, [])
    assert len(items) == 1
    assert items[0]["has_catalyst"] is False
    assert items[0]["no_catalyst_warning"] == NO_CATALYST_WARNING


def test_quality_score_below_40_filtered() -> None:
    gaps = [
        PremarketGapCandidate(
            symbol="LOW",
            prev_close=100.0,
            premarket_price=101.0,
            gap_percent=1.0,
            day_volume=900_000.0,
            direction="up",
            rank_score=1.0,
        )
    ]
    snaps = {"LOW": _snap("LOW", prev_close=100, price=101, vol=900_000, adv=900_000)}
    items = build_gap_intelligence_items(gaps, snaps, [])
    assert items == []


def test_thin_volume_filtered_out() -> None:
    gaps = [
        PremarketGapCandidate(
            symbol="THIN",
            prev_close=100.0,
            premarket_price=110.0,
            gap_percent=10.0,
            day_volume=900_000.0,
            direction="up",
            rank_score=10.0,
        )
    ]
    snaps = {"THIN": _snap("THIN", prev_close=100, price=110, vol=900_000, adv=5_000_000)}
    arts = [_art("THIN news", ["THIN"])]
    items = build_gap_intelligence_items(gaps, snaps, arts)
    assert items == []


def test_penny_stock_filtered_out() -> None:
    gaps = [
        PremarketGapCandidate(
            symbol="PEN",
            prev_close=2.0,
            premarket_price=2.4,
            gap_percent=20.0,
            day_volume=900_000.0,
            direction="up",
            rank_score=20.0,
        )
    ]
    snaps = {"PEN": _snap("PEN", prev_close=2, price=2.4, vol=900_000, adv=2_000_000)}
    arts = [_art("PEN merger announced", ["PEN"])]
    items = build_gap_intelligence_items(gaps, snaps, arts)
    assert items == []


def test_sorted_catalyst_first_then_none() -> None:
    gaps = [
        PremarketGapCandidate(
            symbol="A",
            prev_close=100.0,
            premarket_price=110.0,
            gap_percent=10.0,
            day_volume=900_000.0,
            direction="up",
            rank_score=10.0,
        ),
        PremarketGapCandidate(
            symbol="B",
            prev_close=50.0,
            premarket_price=55.0,
            gap_percent=10.0,
            day_volume=900_000.0,
            direction="up",
            rank_score=10.0,
        ),
    ]
    snaps = {
        "A": _snap("A", prev_close=100, price=110, vol=900_000, adv=400_000),
        "B": _snap("B", prev_close=50, price=55, vol=900_000, adv=400_000),
    }
    arts = [_art("A corp beats earnings expectations", ["A"])]
    items = build_gap_intelligence_items(gaps, snaps, arts)
    assert [x["symbol"] for x in items] == ["A", "B"]
    assert items[0]["has_catalyst"] is True
    assert items[1]["has_catalyst"] is False


def test_quality_score_calculation_correct() -> None:
    assert calculate_gap_quality_score(10.0, 2.0, True, 15.0) == 100
    assert calculate_gap_quality_score(2.0, 1.0, False, 5.0) == 30


def test_duplicate_catalyst_headline_primary_first_in_title() -> None:
    """Same article on two gaps: headline stays on ticker that appears first in the title."""
    title = "GME and EBAY surge on merger talk"
    art = NewsArticle(
        article_id="dup-shared",
        published_at=datetime.now(timezone.utc) - timedelta(hours=1),
        title=title,
        description="",
        url="https://example.com",
        source="Reuters",
        tickers=["GME", "EBAY"],
        keywords=[],
    )
    gaps = [
        PremarketGapCandidate(
            symbol="GME",
            prev_close=100.0,
            premarket_price=110.0,
            gap_percent=10.0,
            day_volume=900_000.0,
            direction="up",
            rank_score=10.0,
        ),
        PremarketGapCandidate(
            symbol="EBAY",
            prev_close=50.0,
            premarket_price=55.0,
            gap_percent=10.0,
            day_volume=900_000.0,
            direction="up",
            rank_score=10.0,
        ),
    ]
    snaps = {
        "GME": _snap("GME", prev_close=100, price=110, vol=900_000, adv=900_000),
        "EBAY": _snap("EBAY", prev_close=50, price=55, vol=900_000, adv=900_000),
    }
    items = build_gap_intelligence_items(gaps, snaps, [art])
    by_sym = {row["symbol"]: row for row in items}
    assert by_sym["GME"]["catalyst"]["headline"] == title
    assert by_sym["EBAY"]["catalyst"]["headline"] == SECONDARY_SHARED_CATALYST_HEADLINE
    assert by_sym["EBAY"]["catalyst"]["category"] == by_sym["GME"]["catalyst"]["category"]


def test_duplicate_catalyst_headline_primary_by_gap_quality_when_no_ticker_in_title() -> None:
    title = "Merger talks lift related names"
    art = NewsArticle(
        article_id="dup-q",
        published_at=datetime.now(timezone.utc) - timedelta(hours=1),
        title=title,
        description="",
        url="https://example.com",
        source="Reuters",
        tickers=["GME", "EBAY"],
        keywords=[],
    )
    gaps = [
        PremarketGapCandidate(
            symbol="EBAY",
            prev_close=50.0,
            premarket_price=55.0,
            gap_percent=10.0,
            day_volume=900_000.0,
            direction="up",
            rank_score=10.0,
        ),
        PremarketGapCandidate(
            symbol="GME",
            prev_close=100.0,
            premarket_price=110.0,
            gap_percent=10.0,
            day_volume=900_000.0,
            direction="up",
            rank_score=10.0,
        ),
    ]
    snaps = {
        "EBAY": _snap("EBAY", prev_close=50, price=55, vol=900_000, adv=900_000),
        "GME": _snap("GME", prev_close=100, price=110, vol=900_000, adv=400_000),
    }
    items = build_gap_intelligence_items(gaps, snaps, [art])
    by_sym = {row["symbol"]: row for row in items}
    assert by_sym["GME"]["catalyst"]["headline"] == title
    assert by_sym["EBAY"]["catalyst"]["headline"] == SECONDARY_SHARED_CATALYST_HEADLINE
