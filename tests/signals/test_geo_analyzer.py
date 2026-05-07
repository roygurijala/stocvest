import pytest

from stocvest.signals.geo_analyzer import GeoAnalyzer, clear_geo_cache


@pytest.fixture(autouse=True)
def _deterministic_geo_themes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "stocvest.signals.geo_analyzer.get_cached_themes",
        lambda: {"active_themes": [], "as_of": "test", "source": "fixture"},
    )


def test_war_keywords_high_risk() -> None:
    clear_geo_cache()
    g = GeoAnalyzer().analyze([{"title": "war escalation feared", "description": "", "tickers": ["SPY"]}])
    assert g.score is not None
    assert g.score <= 45
    assert g.high_impact_count == 1
    assert g.geo_has_live_events is True
    assert g.risk_level in {"high", "medium"}


def test_no_articles_structural_available() -> None:
    clear_geo_cache()
    g = GeoAnalyzer().analyze([])
    assert g.score is not None
    assert 52 <= int(g.score) <= 92
    assert g.status == "available"
    assert g.high_impact_count == 0
    assert g.geo_has_live_events is False
    assert str(g.geo_baseline_summary or "").strip() != ""
    assert g.geo_baseline_score is not None


def test_tariff_headlines_no_high_bucket_without_keyword_event_bundle() -> None:
    """Generic 'tariff' copy scores medium severity but may not classify into a GEO_SECTOR_IMPACT bundle."""
    clear_geo_cache()
    g = GeoAnalyzer().analyze([{"title": "tariff dispute", "description": "trade tension", "tickers": ["SPY"]}])
    assert g.high_impact_count == 0
    assert isinstance(g.score, int)
    assert "Structural exposure" in " ".join(g.chips) or g.geo_has_live_events is True


def test_cache_reuse() -> None:
    clear_geo_cache()
    arts = [{"title": "tariff dispute", "description": "trade tension", "tickers": ["SPY"]}]
    a = GeoAnalyzer().analyze(arts)
    b = GeoAnalyzer().analyze(arts)
    assert a.score == b.score
