"""Tests for the Benzinga 'broader coverage' section in serialize_symbol_context."""

from __future__ import annotations

from datetime import datetime, timezone

from stocvest.api.services.assistant_symbol_context import AssistantSymbolContext
from stocvest.data.benzinga_client import BenzingaArticle
from stocvest.data.models import Bar, NewsArticle, Timeframe
from stocvest.data.benzinga_client import BenzingaRating
from stocvest.signals.assistant_chat import (
    _analyst_consensus_lines,
    _benzinga_channel_category,
    _classify_rating,
    _stocvest_read_lines,
    serialize_symbol_context,
)
from stocvest.data.models import Snapshot


def _intraday_bar(close: float, minute: int) -> Bar:
    return Bar(
        symbol="NVDA",
        timestamp=datetime(2026, 6, 3, 14, minute, tzinfo=timezone.utc),
        timeframe=Timeframe.MIN_5,
        open=close,
        high=close,
        low=close,
        close=close,
        volume=1000.0,
    )


def _article(title: str, channels: list[str]) -> BenzingaArticle:
    return BenzingaArticle(
        article_id="1",
        title=title,
        body=None,
        published_at=datetime.now(timezone.utc),
        tickers=["NVDA"],
        channels=channels,
    )


def test_channel_category_maps_known_channels() -> None:
    assert _benzinga_channel_category(["Analyst Ratings", "Upgrades"]) == "analyst"
    assert _benzinga_channel_category(["M&A"]) == "m&a"
    assert _benzinga_channel_category(["Government", "Politics"]) == "policy/legal"
    assert _benzinga_channel_category(["Dividends"]) == "capital"
    assert _benzinga_channel_category(["Some Random Channel"]) == "general"
    assert _benzinga_channel_category([]) == "general"


def test_broader_coverage_section_rendered() -> None:
    ctx = AssistantSymbolContext(
        symbol="NVDA",
        benzinga_news=[
            _article("NVDA to acquire small AI startup", ["M&A"]),
            _article("Analyst lifts NVDA price target to 200", ["Analyst Ratings"]),
            _article("New export regulations weigh on chipmakers", ["Government"]),
        ],
    )
    block = serialize_symbol_context(ctx)
    assert "BROADER COVERAGE" in block
    assert "[m&a] NVDA to acquire small AI startup" in block
    assert "[analyst] Analyst lifts NVDA price target to 200" in block
    assert "[policy/legal] New export regulations weigh on chipmakers" in block


def _rating(firm: str, action: str, rating: str, pt: float | None, day: int) -> BenzingaRating:
    return BenzingaRating(
        symbol="AVGO",
        action=action,
        rating=rating,
        price_target=pt,
        analyst_firm=firm,
        published_at=datetime(2026, 6, day, tzinfo=timezone.utc),
    )


def test_classify_rating_buckets() -> None:
    assert _classify_rating("Strong Buy") == "bullish"
    assert _classify_rating("Outperform") == "bullish"
    assert _classify_rating("Hold") == "neutral"
    assert _classify_rating("Market Perform") == "neutral"
    assert _classify_rating("Sell") == "bearish"
    assert _classify_rating("Underweight") == "bearish"
    assert _classify_rating("") == "unknown"


def test_analyst_consensus_aggregates_targets_and_mix() -> None:
    ratings = [
        _rating("Morgan Stanley", "Reiterates", "Overweight", 260.0, 2),
        _rating("Needham", "Upgrades", "Buy", 290.0, 1),
        _rating("Goldman", "Maintains", "Hold", 210.0, 3),
        _rating("UBS", "Downgrades", "Sell", 200.0, 1),
    ]
    block = "\n".join(_analyst_consensus_lines(ratings, last_price=218.0))
    assert "ANALYST CONSENSUS" in block
    assert "price_target_avg=$240.00" in block
    assert "range=$200.00-$290.00" in block
    assert "implied_vs_current=+10.1%" in block
    assert "2 buy/outperform / 1 hold/neutral / 1 sell/underperform" in block
    # Most-recent action is the newest by published date (Goldman on the 3rd).
    assert "most_recent=Goldman" in block


def test_analyst_consensus_handles_missing_targets_and_price() -> None:
    ratings = [_rating("FirmA", "Maintains", "Hold", None, 1)]
    block = "\n".join(_analyst_consensus_lines(ratings, last_price=None))
    assert "price_target_avg=n/a" in block
    assert "implied_vs_current" not in block  # no price -> no implied move


def test_analyst_consensus_section_in_symbol_context() -> None:
    ctx = AssistantSymbolContext(
        symbol="AVGO",
        snapshot=Snapshot(symbol="AVGO", last_trade_price=218.0),
        analyst_ratings=[_rating("Needham", "Upgrades", "Buy", 290.0, 1)],
    )
    block = serialize_symbol_context(ctx)
    assert "ANALYST CONSENSUS" in block
    # Raw rows still present for firm-level detail.
    assert "ANALYST RATINGS" in block
    assert block.index("ANALYST CONSENSUS") < block.index("ANALYST RATINGS")


def test_stocvest_read_lines_empty_when_absent() -> None:
    assert _stocvest_read_lines(None) == []
    assert _stocvest_read_lines({"verdict": "sideways"}) == []  # invalid verdict


def test_stocvest_read_block_leads_symbol_context() -> None:
    ctx = AssistantSymbolContext(
        symbol="AVGO",
        benzinga_news=[_article("AVGO news", ["Tech"])],
        stocvest_read={
            "verdict": "neutral",
            "mode": "swing",
            "leans": {"bullish": 1, "bearish": 3, "neutral": 2, "available": 6},
            "alignment_label": "Balanced",
            "alignment_ratio": 0.5,
            "regime": "risk-on",
            "reasoning": "Layers split with no clear leader.",
            "stale": False,
        },
    )
    block = serialize_symbol_context(ctx)
    assert "STOCVEST'S CURRENT READ" in block
    assert "verdict=neutral" in block
    assert "1 bullish / 3 bearish / 2 neutral (of 6 contributing layers)" in block
    assert "alignment=Balanced" in block
    # STOCVEST's read must appear before the broader-coverage news section.
    assert block.index("STOCVEST'S CURRENT READ") < block.index("BROADER COVERAGE")


def test_stocvest_read_block_serializes_limitations() -> None:
    """The not_yet_confirmed caveats are rendered so the model can voice them."""
    ctx = AssistantSymbolContext(
        symbol="AVGO",
        benzinga_news=[_article("AVGO news", ["Tech"])],
        stocvest_read={
            "verdict": "neutral",
            "mode": "swing",
            "leans": {"bullish": 1, "bearish": 3, "neutral": 1, "available": 5},
            "alignment_label": "Balanced",
            "stale": False,
            "limitations": [
                "only 5 of 6 evidence layers have reported",
                "the layers are split — 1 lean bullish and 3 lean bearish",
                "no single direction dominates, so the read is inconclusive",
            ],
        },
    )
    block = serialize_symbol_context(ctx)
    assert "not_yet_confirmed" in block
    assert "only 5 of 6 evidence layers have reported" in block
    assert "no single direction dominates" in block


def test_stocvest_read_block_omits_limitations_when_absent() -> None:
    lines = _stocvest_read_lines(
        {
            "verdict": "bullish",
            "mode": "swing",
            "leans": {"bullish": 5, "bearish": 0, "neutral": 1, "available": 6},
            "alignment_label": "High",
            "stale": False,
        }
    )
    assert not any("not_yet_confirmed" in ln for ln in lines)


def test_broader_coverage_dedupes_against_polygon_news() -> None:
    shared = "NVDA jumps on strong demand"
    ctx = AssistantSymbolContext(
        symbol="NVDA",
        news=[
            NewsArticle(
                article_id="p1",
                title=shared,
                description="desc",
                published_at=datetime.now(timezone.utc),
                source="polygon",
                tickers=["NVDA"],
                url="https://example.com/a",
            )
        ],
        benzinga_news=[
            _article(shared, ["Markets"]),
            _article("Unique Benzinga headline", ["Tech"]),
        ],
    )
    block = serialize_symbol_context(ctx)
    # The shared headline must not be duplicated under broader coverage.
    assert block.count(shared) == 1
    assert "Unique Benzinga headline" in block


def test_broader_coverage_absent_without_benzinga_news() -> None:
    ctx = AssistantSymbolContext(
        symbol="NVDA",
        news=[
            NewsArticle(
                article_id="p1",
                title="Some news",
                description="d",
                published_at=datetime.now(timezone.utc),
                source="polygon",
                tickers=["NVDA"],
                url="https://example.com/b",
            )
        ],
    )
    block = serialize_symbol_context(ctx)
    assert "BROADER COVERAGE" not in block


def test_bars_only_context_has_data_and_derives_price() -> None:
    """When snapshot/news fail but intraday bars arrive, the assistant still gets
    a grounded price read instead of falling back to a generic answer."""
    ctx = AssistantSymbolContext(
        symbol="NVDA",
        bars_5m=[_intraday_bar(100.0, 0), _intraday_bar(104.0, 30)],
    )
    assert ctx.has_data is True
    block = serialize_symbol_context(ctx)
    assert "SNAPSHOT (derived from intraday bars)" in block
    assert "$104.00" in block
    # 100 -> 104 is +4% intraday.
    assert "+4.00%" in block


def test_empty_context_renders_nothing() -> None:
    ctx = AssistantSymbolContext(symbol="NVDA")
    assert ctx.has_data is False
    assert serialize_symbol_context(ctx) == ""
