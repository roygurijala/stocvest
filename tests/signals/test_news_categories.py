from __future__ import annotations

from datetime import datetime, timezone

from stocvest.data.models import NewsArticle
from stocvest.signals.news_catalyst_detector import NewsCatalystDetector


def _a(title: str, tickers: list[str] | None = None) -> NewsArticle:
    return NewsArticle(
        article_id="x",
        published_at=datetime(2026, 5, 2, 12, 0, tzinfo=timezone.utc),
        title=title,
        description="",
        url="https://example.com",
        source="Reuters",
        tickers=tickers or ["ZZZ"],
        keywords=[],
    )


def test_insider_sale_tagged_insider() -> None:
    d = NewsCatalystDetector(min_score=0.2)
    c = d.detect([_a("CEO sold shares via Form 4 10b5-1 plan", ["I"])], limit=1)
    assert c and c[0].catalyst_type == "insider"


def test_analyst_upgrade_tagged_analyst() -> None:
    d = NewsCatalystDetector(min_score=0.2)
    c = d.detect([_a("Firm issues buy rating and overweight on ZZZ", ["Z"])], limit=1)
    assert c and c[0].catalyst_type == "analyst"


def test_fda_approval_tagged_fda() -> None:
    d = NewsCatalystDetector(min_score=0.2)
    c = d.detect([_a("ZZZ receives FDA approval for phase 3 therapy", ["Z"])], limit=1)
    assert c and c[0].catalyst_type == "fda"


def test_merger_news_tagged_merger() -> None:
    d = NewsCatalystDetector(min_score=0.2)
    c = d.detect([_a("ZZZ announces acquisition deal and buyout terms", ["Z"])], limit=1)
    assert c and c[0].catalyst_type == "merger"


def test_takeover_headline_tagged_merger_not_fda() -> None:
    d = NewsCatalystDetector(min_score=0.2)
    c = d.detect([_a("GameStop Eyes eBay Takeover", ["GME"])], limit=1)
    assert c and c[0].catalyst_type == "merger"
    assert c[0].sentiment_label == "bullish"


def test_acquisition_target_headline_stays_mixed() -> None:
    d = NewsCatalystDetector(min_score=0.2)
    c = d.detect([_a("ZZZ seen as acquisition target in sector rollup", ["Z"])], limit=1)
    assert c and c[0].catalyst_type == "merger"
    assert c[0].sentiment_label == "mixed"


def test_agrees_to_buy_merger_acquirer_bullish() -> None:
    d = NewsCatalystDetector(min_score=0.2)
    c = d.detect([_a("Acme to acquire BetaCo in merger deal", ["A"])], limit=1)
    assert c and c[0].catalyst_type == "merger"
    assert c[0].sentiment_label == "bullish"


def test_listicle_growth_stocks_headline_filtered() -> None:
    d = NewsCatalystDetector(min_score=0.2)
    title = "2 Growth Stocks to Invest $500 in Right Now"
    assert d.detect([_a(title, ["VEEV"])], limit=1) == []


def test_noise_patterns_filtered() -> None:
    d = NewsCatalystDetector(min_score=0.2)
    assert d.detect([_a("Here's what that means if you'd invested $10,000 into ZZZ")], limit=1) == []


def test_bullish_keywords_score_above_65() -> None:
    d = NewsCatalystDetector(min_score=0.2)
    c = d.detect([_a("ZZZ exceeded expectations and announced record revenue beat", ["Z"])], limit=1)
    assert c and c[0].narrative_score >= 65
    assert c[0].sentiment_label == "bullish"


def test_bearish_keywords_score_below_45() -> None:
    d = NewsCatalystDetector(min_score=0.2)
    c = d.detect([_a("ZZZ missed estimates and lowered guidance — disappointing loss", ["Z"])], limit=1)
    assert c and c[0].narrative_score <= 45
    assert c[0].sentiment_label == "bearish"
