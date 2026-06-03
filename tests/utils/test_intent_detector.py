from stocvest.utils.intent_detector import (
    is_discovery_query,
    is_market_overview_query,
    is_watchlist_intelligence_query,
    is_watchlist_opportunity_query,
    is_watchlist_status_query,
)


def test_discovery_query_detects_momentum_stocks_phrase() -> None:
    assert is_discovery_query("what are the momentum stocks this morning")


def test_market_overview_query_detects_stock_market_today() -> None:
    assert is_market_overview_query("how is the stock market doing today")


def test_market_overview_query_detects_market_regime_wording() -> None:
    assert is_market_overview_query("what is the market regime right now")


def test_watchlist_status_query_detects_how_is_my_watchlist() -> None:
    assert is_watchlist_status_query("how is my watchlist doing today")
    assert is_watchlist_status_query("what's happening with my watchlist?")
    assert is_watchlist_intelligence_query("how is my watchlist doing today")


def test_watchlist_opportunity_query_detects_best_opportunities() -> None:
    assert is_watchlist_opportunity_query("what are the best opportunities from my watchlist today")
    assert is_watchlist_opportunity_query("any setups on my watchlist?")
    assert is_watchlist_intelligence_query("best plays from my watchlist")


def test_add_to_watchlist_is_not_a_status_query() -> None:
    # An explicit add action mentions "watchlist" but must not trip status intent.
    assert not is_watchlist_status_query("add NVDA to my watchlist")
    assert not is_watchlist_opportunity_query("add NVDA to my watchlist")

