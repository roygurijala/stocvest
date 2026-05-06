from stocvest.signals.geo_analyzer import GEO_HIGH_RISK, GEO_MEDIUM_RISK, GEO_LOW_RISK, GeoAnalyzer, clear_geo_cache
from stocvest.signals.geo_sector_impact import (
    MIDDLE_EAST_CONFLICT,
    US_CHINA_TRADE_TENSION,
    detect_geo_event_scores,
    normalize_sector_for_geo,
    weighted_stock_geo_score,
)


def test_normalize_maps_sic_buckets() -> None:
    assert normalize_sector_for_geo("semiconductors") == "semiconductors"
    assert normalize_sector_for_geo("oil_gas") == "energy"
    assert normalize_sector_for_geo("aerospace_defense") == "defense"


def test_detect_events_trade_war_routes_us_china() -> None:
    arts = [{"title": "New trade war fears hit tech suppliers", "description": ""}]
    ev = detect_geo_event_scores(arts, high_kw=GEO_HIGH_RISK, med_kw=GEO_MEDIUM_RISK, low_kw=GEO_LOW_RISK)
    assert any(e["event_type"] == US_CHINA_TRADE_TENSION for e in ev)


def test_weighted_score_uses_sector_table() -> None:
    events = [{"event_type": MIDDLE_EAST_CONFLICT, "score": 3.0}]
    assert weighted_stock_geo_score(events, "energy") == round(3.0 * 1.8, 3)
    # Semiconductors not listed for Middle East → neutral 1.0
    assert weighted_stock_geo_score(events, "semiconductors") == 3.0


def test_geo_analyzer_passes_sector_for_exposure() -> None:
    clear_geo_cache()
    g = GeoAnalyzer().analyze(
        [{"title": "war escalation feared in region", "description": ""}],
        lookback_hours=8,
        sector_bucket="semiconductors",
    )
    assert g.geo_impact_sector_key == "semiconductors"
    assert g.geo_active_events
    assert g.geo_stock_exposure_score is not None
    assert g.geo_exposure_summary
