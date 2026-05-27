from datetime import datetime, timedelta, timezone

from stocvest.config.signal_parameters import NewsParameters
from stocvest.data.benzinga_client import BenzingaMultiResult, BenzingaRating
from stocvest.signals.news_analyzer import NewsAnalyzer

from tests.signals.conftest import make_negative_articles, make_positive_articles, mock_parameter_store


def test_positive_articles_bullish(mock_parameter_store) -> None:
    n = NewsAnalyzer().analyze("TEST", make_positive_articles(3), mock_parameter_store.news)
    assert n.status == "available"
    assert n.score is not None and n.score >= 65


def test_negative_articles_bearish(mock_parameter_store) -> None:
    n = NewsAnalyzer().analyze("TEST", make_negative_articles(3), mock_parameter_store.news)
    assert n.status == "available"
    assert n.score is not None and n.score <= 40


def test_no_articles_returns_neutral_available(mock_parameter_store) -> None:
    n = NewsAnalyzer().analyze("TEST", [], mock_parameter_store.news)
    assert n.status == "available"
    assert n.score == 50
    assert n.verdict == "neutral"


def test_pr_wire_filtered(mock_parameter_store) -> None:
    articles = [
        {
            "title": "PR fluff",
            "tickers": ["TEST"],
            "published_utc": "2026-05-04T12:00:00Z",
            "insights": [{"sentiment": "positive"}],
            "publisher": {"name": "PR Newswire"},
        }
    ]
    n = NewsAnalyzer().analyze("TEST", articles, mock_parameter_store.news)
    assert n.status == "available"
    assert n.verdict == "neutral"


def test_structured_analyst_consensus_chip_on_swing(mock_parameter_store) -> None:
    now = datetime.now(timezone.utc)
    bz = BenzingaMultiResult(
        ratings=[
            BenzingaRating("TEST", "Upgrade", "Buy", 120.0, "Goldman Sachs", now - timedelta(days=1)),
            BenzingaRating("TEST", "Upgrade", "Buy", 118.0, "Morgan Stanley", now - timedelta(days=5)),
            BenzingaRating("TEST", "Upgrade", "Outperform", 115.0, "JPMorgan", now - timedelta(days=12)),
            BenzingaRating("TEST", "Upgrade", "Buy", 117.0, "Bank of America", now - timedelta(days=18)),
        ]
    )
    n = NewsAnalyzer().analyze(
        "TEST",
        make_positive_articles(2),
        mock_parameter_store.news,
        mode="swing",
        benzinga_data=bz,
        current_price=100.0,
    )
    assert n.analyst_consensus is not None
    assert n.analyst_consensus.get("momentum", 0) >= 3
    assert any("consensus improving" in c.lower() for c in n.chips)


def test_params_threshold_used(mock_parameter_store) -> None:
    p = mock_parameter_store.news
    p.bullish_threshold = 70
    n = NewsAnalyzer().analyze("TEST", make_positive_articles(2), p)
    if n.score is not None:
        assert n.verdict != "bullish" or n.score >= 70
