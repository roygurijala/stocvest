"""Tests for the Benzinga 'broader coverage' section in serialize_symbol_context."""

from __future__ import annotations

from datetime import datetime, timezone

from stocvest.api.services.assistant_symbol_context import AssistantSymbolContext
from stocvest.data.benzinga_client import BenzingaArticle
from stocvest.data.models import NewsArticle
from stocvest.signals.assistant_chat import (
    _benzinga_channel_category,
    serialize_symbol_context,
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
