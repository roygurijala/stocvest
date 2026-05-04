from stocvest.signals.geo_analyzer import GeoAnalyzer, clear_geo_cache


def test_war_keywords_high_risk() -> None:
    clear_geo_cache()
    g = GeoAnalyzer().analyze([{"title": "war escalation feared", "description": "", "tickers": ["SPY"]}])
    assert g.score == 25
    assert g.risk_level == "high"


def test_no_articles_score_60() -> None:
    clear_geo_cache()
    g = GeoAnalyzer().analyze([])
    assert g.score == 60
    assert g.status == "available"


def test_cache_reuse() -> None:
    clear_geo_cache()
    arts = [{"title": "tariff dispute", "description": "trade tension", "tickers": ["SPY"]}]
    a = GeoAnalyzer().analyze(arts)
    b = GeoAnalyzer().analyze(arts)
    assert a.score == b.score
