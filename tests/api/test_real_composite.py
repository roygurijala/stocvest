from stocvest.signals.confluence import ConfluenceDetector


def test_confluence_positive_sentiment_confirms_long() -> None:
    cf = ConfluenceDetector().calculate_confluence(
        symbol="TEST",
        direction="long",
        signal_data={
            "pattern": "orb_breakout_long",
            "volume_vs_avg": 2.0,
            "gap_pct": 0.0,
            "ema9": 99.0,
            "last_trade_price": 101.0,
        },
        snapshot={"last_trade_price": 101.0, "day_vwap": 100.0},
        news_catalyst={"headline": "Beat", "sentiment": "positive"},
        regime="bull",
        sector_signal="bullish",
    )
    assert cf.n_confirming >= 1
    assert any(x.get("source") == "news_catalyst" for x in cf.confirming_signals)


def test_confluence_risk_on_regime_matches_long() -> None:
    cf = ConfluenceDetector().calculate_confluence(
        symbol="TEST",
        direction="long",
        signal_data={"pattern": "orb_long", "volume_vs_avg": 1.0, "gap_pct": 0.0, "ema9": 100.0, "last_trade_price": 101.0},
        snapshot={"last_trade_price": 101.0, "day_vwap": 99.0},
        news_catalyst=None,
        regime="risk_on",
        sector_signal="neutral",
    )
    assert any(x.get("source") == "market_regime" for x in cf.confirming_signals)
