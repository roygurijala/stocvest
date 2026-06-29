from stocvest.utils.intent_detector import (
    detect_explicit_desk,
    is_chart_relevant_query,
    is_discovery_query,
    is_forecast_query,
    is_market_overview_query,
    is_mode_sensitive_query,
    is_price_chart_query,
    is_watchlist_intelligence_query,
    is_comparison_query,
    is_watchlist_opportunity_query,
    is_watchlist_status_query,
    is_web_search_query,
)


def test_comparison_query_matches_head_to_head_phrasing() -> None:
    assert is_comparison_query("compare NVDA vs AMD")
    assert is_comparison_query("which is stronger, NVDA or AMD?")
    assert is_comparison_query("NVDA versus AMD")
    assert is_comparison_query("which one looks better between NVDA and AMD")
    assert is_comparison_query("is NVDA or AMD a better setup")


def test_comparison_query_ignores_non_comparison_and_empty() -> None:
    assert not is_comparison_query("")
    assert not is_comparison_query("how is NVDA doing today")
    assert not is_comparison_query("explain what VWAP means")


def test_web_search_query_matches_out_of_envelope_questions() -> None:
    assert is_web_search_query("what's the latest on the fed?")
    assert is_web_search_query("any news about the new tariffs")
    assert is_web_search_query("what's happening with the economy")
    assert is_web_search_query("tell me about the CPI report")
    assert is_web_search_query("how is the semiconductor sector doing this week")
    assert is_web_search_query("recent developments in the rate cut debate")
    assert is_web_search_query("what do you know about the OPEC decision")


def test_web_search_query_ignores_plain_symbol_and_empty() -> None:
    assert not is_web_search_query("")
    assert not is_web_search_query("explain RSI")
    assert not is_web_search_query("what does stocvest think of AVGO")


def test_price_chart_vs_forecast_query_split() -> None:
    # Price/movement/technical -> price chart query (always charts).
    assert is_price_chart_query("how is broadcom doing today")
    assert is_price_chart_query("why is AVGO down today")
    assert is_price_chart_query("what is the support and resistance for nvda")
    assert not is_price_chart_query("what is the forecast of broadcom")
    assert not is_price_chart_query("whats the outlook for AVGO")
    # Forecast/outlook/target -> forecast query (charts only when targets exist).
    assert is_forecast_query("what is the forecast of broadcom")
    assert is_forecast_query("whats the outlook for AVGO")
    assert is_forecast_query("what's the analyst price target for nvda")
    assert not is_forecast_query("how is broadcom doing today")
    assert not is_forecast_query("what does stocvest think of broadcom")


def test_chart_relevant_for_price_movement_and_forecast_questions() -> None:
    assert is_chart_relevant_query("how is broadcom doing today")
    assert is_chart_relevant_query("why is AVGO down today")
    assert is_chart_relevant_query("what is the support and resistance for nvda")
    assert is_chart_relevant_query("show me the chart for tsla")
    assert is_chart_relevant_query("how did broadcom do today")
    # Trade-planning leans on levels -> chart relevant.
    assert is_chart_relevant_query("what's the entry price for mrvl")
    # Forecast/outlook now shows the current price vs the analyst target range.
    assert is_chart_relevant_query("what is the forecast of broadcom")
    assert is_chart_relevant_query("whats the outlook for AVGO")
    assert is_chart_relevant_query("what's the analyst price target for nvda")


def test_chart_not_relevant_for_verdict_news_or_concept() -> None:
    assert not is_chart_relevant_query("what does stocvest think of broadcom")
    assert not is_chart_relevant_query("any news on palantir")
    assert not is_chart_relevant_query("what is a p/e ratio")
    assert not is_chart_relevant_query("tell me about broadcom")
    assert not is_chart_relevant_query("")


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


def test_detect_explicit_desk_day_variants() -> None:
    assert detect_explicit_desk("show me day-trading momentum stocks") == "day"
    assert detect_explicit_desk("any intraday setups?") == "day"
    assert detect_explicit_desk("Focus on day (intraday) setups") == "day"


def test_detect_explicit_desk_swing_variants() -> None:
    assert detect_explicit_desk("what swing setups look good") == "swing"
    assert detect_explicit_desk("Focus on swing (multi-day) setups") == "swing"
    assert detect_explicit_desk("any multi-day plays?") == "swing"


def test_detect_explicit_desk_none_when_ambiguous() -> None:
    assert detect_explicit_desk("what's moving today?") is None
    assert detect_explicit_desk("") is None


def test_is_mode_sensitive_query_covers_discovery_and_opportunity() -> None:
    assert is_mode_sensitive_query("what are the momentum stocks this morning")
    assert is_mode_sensitive_query("what are the best opportunities from my watchlist today")
    assert not is_mode_sensitive_query("what is a P/E ratio")

