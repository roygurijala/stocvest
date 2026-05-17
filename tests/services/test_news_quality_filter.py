from __future__ import annotations

from stocvest.api.services.news_quality_filter import get_publisher_tier, is_quality_article, passes_market_intelligence_gate


def _article(*, publisher: str, title: str = "Headline", description: str = "desc", tickers: list[str] | None = None):
    return {
        "publisher": {"name": publisher},
        "title": title,
        "description": description,
        "tickers": tickers if tickers is not None else ["AAPL"],
    }


def test_blocks_globenewswire() -> None:
    assert is_quality_article(_article(publisher="GlobeNewswire")) is False


def test_blocks_prnewswire() -> None:
    assert is_quality_article(_article(publisher="PRNewswire")) is False


def test_allows_reuters() -> None:
    assert is_quality_article(_article(publisher="Reuters")) is True


def test_allows_bloomberg() -> None:
    assert is_quality_article(_article(publisher="Bloomberg")) is True


def test_blocks_cagr_content() -> None:
    assert is_quality_article(_article(publisher="Reuters", title="AI market CAGR to 2030")) is False


def test_blocks_market_research() -> None:
    assert is_quality_article(_article(publisher="Reuters", description="Global market research report")) is False


def test_requires_tickers() -> None:
    assert is_quality_article(_article(publisher="Reuters", tickers=[])) is False


def test_intel_gate_allows_insights_only_ticker_tags() -> None:
    art = _article(publisher="Reuters", tickers=[])
    art["insights"] = [{"ticker": "AMZN", "sentiment": "positive"}]
    assert passes_market_intelligence_gate(art) is True
    assert is_quality_article(art) is True


def test_blocks_historical_returns_content() -> None:
    assert is_quality_article(_article(publisher="Reuters", title="Best performing stock in 10 years of returns")) is False


def test_blocks_since_ipo_content() -> None:
    assert is_quality_article(_article(publisher="Reuters", description="Historical returns since IPO")) is False


def test_tier_1_publisher_identified() -> None:
    assert get_publisher_tier("Reuters") == 1
    assert get_publisher_tier("Unknown Blog") == 2


def test_intel_gate_allows_pr_wire_when_tickers_clean() -> None:
    assert passes_market_intelligence_gate(_article(publisher="GlobeNewswire")) is True
    assert is_quality_article(_article(publisher="GlobeNewswire")) is False