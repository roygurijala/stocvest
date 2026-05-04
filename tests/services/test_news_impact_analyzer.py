from __future__ import annotations

from stocvest.api.services.news_impact_analyzer import analyze_news_impact, generate_impact_summary


def _article(
    *,
    tickers: list[str],
    title: str = "Headline",
    sentiment: str = "neutral",
):
    return {
        "tickers": tickers,
        "title": title,
        "description": "desc",
        "insights": [{"sentiment": sentiment}],
    }


def test_direct_ticker_impact() -> None:
    out = analyze_news_impact(_article(tickers=["AAPL"], sentiment="positive"))
    assert out[0]["symbol"] == "AAPL"
    assert out[0]["is_direct"] is True


def test_earnings_beat_is_bullish() -> None:
    out = analyze_news_impact(_article(tickers=["AAPL"], title="AAPL earnings beat", sentiment="neutral"))
    assert out[0]["impact"] == "bullish"


def test_earnings_miss_is_bearish() -> None:
    out = analyze_news_impact(_article(tickers=["AAPL"], title="AAPL misses and disappoints", sentiment="positive"))
    assert out[0]["impact"] == "bearish"


def test_macro_fed_adds_spy_qqq() -> None:
    out = analyze_news_impact(_article(tickers=["TLT"], title="Fed rate cut expected", sentiment="neutral"))
    syms = {x["symbol"] for x in out}
    assert "SPY" in syms and "QQQ" in syms


def test_tech_earnings_adds_qqq_sector() -> None:
    out = analyze_news_impact(_article(tickers=["NVDA"], sentiment="positive"))
    syms = {x["symbol"] for x in out}
    assert "QQQ" in syms


def test_watchlist_symbol_prioritized() -> None:
    out = analyze_news_impact(_article(tickers=["AAPL", "MSFT"], sentiment="positive"), watchlist_symbols=["MSFT"])
    assert out[0]["symbol"] == "MSFT"


def test_max_5_chips_returned() -> None:
    out = analyze_news_impact(_article(tickers=["AAPL", "MSFT", "NVDA", "TSLA", "META", "GOOGL"]))
    assert len(out) <= 5


def test_watchlist_symbol_flagged() -> None:
    out = analyze_news_impact(_article(tickers=["AAPL"]), watchlist_symbols=["AAPL"])
    assert out[0]["is_watchlist"] is True


def test_dedupes_ticker_aliases() -> None:
    out = analyze_news_impact(_article(tickers=["GOOG", "GOOGL"], sentiment="positive"))
    syms = [x["symbol"] for x in out]
    assert syms.count("GOOGL") == 1


def test_filters_obscure_tickers_from_chips() -> None:
    out = analyze_news_impact(_article(tickers=["ZZZZQ"], sentiment="positive"))
    assert out == []


def test_macro_summary_template() -> None:
    article = _article(tickers=["SPY"], title="Fed signals rate hold", sentiment="neutral")
    out = analyze_news_impact(article)
    summary = generate_impact_summary(article, out)
    assert summary == "Macro catalyst — broad market impact on SPY/QQQ/TLT."


def test_earnings_positive_summary_template() -> None:
    article = _article(tickers=["AAPL"], title="AAPL EPS beat and revenue beat", sentiment="positive")
    out = analyze_news_impact(article)
    summary = generate_impact_summary(article, out)
    assert summary == "Earnings beat — direct catalyst, watch sector lift."