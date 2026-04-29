from __future__ import annotations

from datetime import datetime, timezone

import pytest

from stocvest.data.models import NewsArticle
from stocvest.signals.macro_events import MacroEventDetector, MacroEventType


def article(title: str, description: str = "", article_id: str = "m-1") -> NewsArticle:
    return NewsArticle(
        article_id=article_id,
        published_at=datetime(2026, 4, 28, 13, 0, tzinfo=timezone.utc),
        title=title,
        description=description,
        url="https://example.com/macro",
        source="MacroWire",
        tickers=["SPY"],
        keywords=[],
    )


@pytest.mark.unit
def test_detects_cpi_with_bullish_direction():
    detector = MacroEventDetector()
    evt = detector.detect_from_article(
        article("CPI cools sharply", "Inflation report comes in below expectations.")
    )

    assert evt is not None
    assert evt.event_type == MacroEventType.CPI
    assert evt.direction == 1
    assert evt.severity > 0.85


@pytest.mark.unit
def test_detects_fomc_hawkish_as_bearish():
    detector = MacroEventDetector()
    evt = detector.detect_from_article(
        article("FOMC signals hawkish stance", "Federal Reserve hints at another hike.")
    )

    assert evt is not None
    assert evt.event_type == MacroEventType.FOMC
    assert evt.direction == -1
    assert evt.confidence >= 0.85


@pytest.mark.unit
def test_non_macro_article_returns_none():
    detector = MacroEventDetector()
    evt = detector.detect_from_article(
        article("Apple unveils new iPad lineup", "Product refresh event this spring.")
    )
    assert evt is None


@pytest.mark.unit
def test_detect_from_articles_filters_non_macro():
    detector = MacroEventDetector()
    events = detector.detect_from_articles(
        [
            article("CPI cools in March", "Consumer price index slows."),
            article("Retail sales beat forecasts", "Consumers continue spending."),
            article("Company announces new headquarters", "No macro driver."),
        ]
    )
    assert len(events) == 2
    assert {e.event_type for e in events} == {MacroEventType.CPI, MacroEventType.RETAIL_SALES}


@pytest.mark.unit
def test_aggregate_market_bias_clamped_range():
    detector = MacroEventDetector()
    events = detector.detect_from_articles(
        [
            article("FOMC turns dovish", "Federal Reserve hints at rate cut."),
            article("CPI cools further", "Inflation below expectations."),
        ]
    )
    bias = detector.aggregate_market_bias(events)
    assert -1.0 <= bias <= 1.0
    assert bias > 0


@pytest.mark.unit
def test_negated_phrase_does_not_trigger_direction():
    detector = MacroEventDetector()
    evt = detector.detect_from_article(
        article("FOMC commentary", "Officials say no hike is likely this meeting.")
    )
    assert evt is not None
    assert evt.direction == 0
