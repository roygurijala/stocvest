"""Structural geo baseline helpers (themes + sector map)."""

from __future__ import annotations

import pytest

from stocvest.signals.geo_analyzer import GeoAnalyzer, clear_geo_cache, compute_geo_baseline
from stocvest.config.signal_parameters import NewsParameters
from stocvest.data.benzinga_client import BenzingaMultiResult
from stocvest.signals.news_analyzer import NewsAnalyzer


@pytest.fixture(autouse=True)
def _fixture_geo(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "stocvest.signals.geo_analyzer.get_cached_themes",
        lambda: {"active_themes": [], "as_of": "test", "source": "fixture"},
    )


def test_baseline_no_themes_returns_low() -> None:
    baseline = compute_geo_baseline("semiconductors", [])
    assert baseline["baseline_score"] == 15
    assert baseline["exposure_band"] == "Low"
    assert "no active geo themes" in baseline["baseline_summary"].lower()


def test_semiconductor_high_on_us_china() -> None:
    baseline = compute_geo_baseline(
        "semiconductors",
        [{"key": "us_china_trade_tension", "display_name": "US-China Trade Tension", "description": "Chip export rules"}],
    )
    assert baseline["exposure_band"] == "High"
    assert baseline["max_weight"] >= 1.5
    assert "US-China" in baseline["baseline_summary"]


def test_comms_low_on_middle_east() -> None:
    baseline = compute_geo_baseline(
        "communication_services",
        [{"key": "middle_east_conflict", "display_name": "Middle East", "description": "Regional conflict"}],
    )
    assert baseline["exposure_band"] == "Low"
    assert baseline["max_weight"] <= 0.6


def test_baseline_summary_never_empty() -> None:
    baseline = compute_geo_baseline("technology", [])
    assert baseline["baseline_summary"].strip()


def test_geo_layer_never_blank_no_articles(monkeypatch: pytest.MonkeyPatch) -> None:
    clear_geo_cache()
    g = GeoAnalyzer().analyze([])
    assert g.geo_baseline_score is not None
    assert str(g.geo_baseline_summary or "").strip()
    assert g.geo_exposure_band in {"low", "moderate", "high"}
    assert getattr(g, "status", "") == "available"


def test_news_sentiment_neutral_when_no_articles(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "stocvest.api.services.news_quality_filter.is_quality_article", lambda article: False
    )
    nr = NewsAnalyzer().analyze(
        "AAPL",
        [{"title": "Ignored", "description": "", "tickers": [], "published_utc": ""}],
        NewsParameters(),
        mode="day",
        benzinga_data=BenzingaMultiResult(),
    )
    assert nr.verdict == "neutral"
    assert nr.weighted_sentiment == 0.0
    assert nr.data_state == "stale"
    low = nr.reasoning.lower()
    assert any(
        phrase in low
        for phrase in (
            "no qualifying news",
            "no material news",
            "no company-specific catalysts",
            "lookback",
            "filtered feed",
        )
    )
    assert "unavailable" not in nr.reasoning.lower()
