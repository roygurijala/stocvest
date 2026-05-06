from stocvest.signals.geo_analyzer import GeoAnalyzer, clear_geo_cache


def test_war_keywords_high_risk() -> None:
    clear_geo_cache()
    g = GeoAnalyzer().analyze([{"title": "war escalation feared", "description": "", "tickers": ["SPY"]}])
    assert g.score == 25
    assert g.risk_level == "high"
    assert g.high_impact_count == 1


def test_no_articles_score_60() -> None:
    clear_geo_cache()
    g = GeoAnalyzer().analyze([])
    assert g.score == 60
    assert g.status == "available"
    assert g.high_impact_count == 0


def test_tariff_only_counts_medium_not_high_impact() -> None:
    clear_geo_cache()
    g = GeoAnalyzer().analyze([{"title": "tariff dispute", "description": "trade tension", "tickers": ["SPY"]}])
    assert g.high_impact_count == 0
    assert "H/M/L hits 0/1/0" in " ".join(g.chips)


def test_cache_reuse() -> None:
    clear_geo_cache()
    arts = [{"title": "tariff dispute", "description": "trade tension", "tickers": ["SPY"]}]
    a = GeoAnalyzer().analyze(arts)
    b = GeoAnalyzer().analyze(arts)
    assert a.score == b.score
